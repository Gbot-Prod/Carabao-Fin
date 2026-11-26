"""Admin-recorded refunds (A2).

A paid transaction becomes ``refund_pending`` when its order is cancelled, a
payment lands on a closed order, or an admin refunds a disputed delivery.

The admin either sends the refund through the PayMongo Refunds API (it becomes
``refunded`` when PayMongo confirms it, by webhook or a refresh) or returns the
money outside Carabao (GCash, bank transfer, ...) and records the method and
reference here.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, cast

import requests
from sqlalchemy.orm import Session

from app.core.errors import describe_error
from app.integrations.sms.semaphore import SemaphoreError, send_sms
from app.models.statuses import TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.services import audit_log, email, money, notifications, paymongo

logger = logging.getLogger(__name__)

REFUND_METHODS = {
    "paymongo": "PayMongo refund",
    "gcash": "GCash",
    "maya": "Maya",
    "bank_transfer": "Bank transfer",
    "cash": "Cash",
}


class RefundError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def order_ref(txn: Transaction) -> str:
    order = txn.order
    return notifications.format_order_ref(
        cast(int, txn.order_id), order.ordered_at if order is not None else None
    )


def _locked(db: Session, transaction_id: int) -> Transaction:
    txn = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id)
        .with_for_update()
        .first()
    )
    if txn is None:
        raise RefundError(404, "Transaction not found")
    return txn


def _mark_refunded(
    db: Session,
    txn: Transaction,
    *,
    admin: User | None,
    method: str,
    reference: str,
    notes: str | None,
) -> None:
    """refund_pending -> refunded, with the buyer's in-app notice and the
    audit entry. The caller commits, then calls notify_buyer_refunded."""
    before = {"status": txn.status}
    txn.status = TransactionStatus.REFUNDED
    txn.refund_method = method
    txn.refund_reference = reference
    txn.refund_notes = (notes or "").strip() or None
    txn.refunded_at = datetime.now(UTC)
    if admin is not None:
        txn.refunded_by = admin.id
    txn.paymongo_refund_status = None
    txn.refund_failure_reason = None
    notifications.notify(
        db,
        txn.user_id,
        notifications.REFUND,
        f"Refund sent for {order_ref(txn)}",
        f"PHP {txn.amount:,} via {REFUND_METHODS[method]}.",
        f"/orders/{txn.order_id}",
    )
    after = {
        "status": txn.status,
        "amount": txn.amount,
        "refund_method": txn.refund_method,
        "refund_reference": txn.refund_reference,
        "refund_notes": txn.refund_notes,
    }
    if admin is not None:
        audit_log.record_admin_action(
            db,
            admin=admin,
            action=audit_log.REFUND,
            target_type="transaction",
            target_id=txn.id,
            before=before,
            after=after,
        )
    else:
        # PayMongo confirmed a sent refund by webhook.
        audit_log.record_system_action(
            db,
            action=audit_log.REFUND,
            target_type="transaction",
            target_id=txn.id,
            before=before,
            after=after,
        )


def record_refund(
    db: Session,
    *,
    transaction_id: int,
    admin: User,
    method: str,
    reference: str,
    notes: str | None = None,
) -> Transaction:
    """An admin returned the money outside Carabao and records it."""
    if method not in REFUND_METHODS:
        raise RefundError(422, "Unknown refund method")
    reference = reference.strip()
    if not reference:
        raise RefundError(422, "A refund reference is required")

    txn = _locked(db, transaction_id)
    if txn.status != TransactionStatus.REFUND_PENDING:
        raise RefundError(409, f"Transaction is {txn.status}, not refund_pending")
    if txn.paymongo_refund_status == PAYMONGO_PROCESSING:
        # Recording it as well would pay the buyer twice.
        raise RefundError(
            409,
            "A PayMongo refund is in progress for this payment. "
            "Refresh it instead of recording another refund.",
        )

    _mark_refunded(
        db, txn, admin=admin, method=method, reference=reference, notes=notes
    )
    db.commit()
    db.refresh(txn)
    notify_buyer_refunded(txn)
    return txn


# ---------------------------------------------------------------------------
# Refunds sent through the PayMongo Refunds API
# ---------------------------------------------------------------------------

# transactions.paymongo_refund_status
PAYMONGO_PROCESSING = "processing"  # sent; PayMongo has not finished it
PAYMONGO_UNKNOWN = "unknown"  # no answer: it may exist, check the dashboard
PAYMONGO_FAILED = "failed"  # refused or failed: nothing refunded, can resend

_SUCCEEDED = {"succeeded", "paid"}
_FAILED = {"failed", "cancelled", "canceled", "expired", "declined"}
FAILURE_REASON_MAX = 500


def can_send_paymongo(txn: Transaction) -> bool:
    return (
        txn.status == TransactionStatus.REFUND_PENDING
        and bool(txn.paymongo_payment_id)
        and txn.paymongo_refund_status not in (PAYMONGO_PROCESSING, PAYMONGO_UNKNOWN)
    )


def send_paymongo_refund(
    db: Session, *, transaction_id: int, admin: User
) -> Transaction:
    """Refund the whole payment through PayMongo.

    A refused refund is saved as ``failed`` with PayMongo's reason; the admin
    can send it again or record a manual refund. No answer is saved as
    ``unknown`` and is not sent again from here, so the buyer is never paid
    twice: the admin checks the PayMongo dashboard and records it.
    """
    txn = _locked(db, transaction_id)
    if txn.status != TransactionStatus.REFUND_PENDING:
        raise RefundError(409, f"Transaction is {txn.status}, not refund_pending")
    if not txn.paymongo_payment_id:
        raise RefundError(
            409, "This payment has no PayMongo payment ID. Record a manual refund."
        )
    if txn.paymongo_refund_status == PAYMONGO_PROCESSING:
        raise RefundError(409, "A PayMongo refund is already in progress")
    if txn.paymongo_refund_status == PAYMONGO_UNKNOWN:
        raise RefundError(
            409,
            "An earlier refund may have gone through. Check the PayMongo "
            "dashboard, then record the refund manually.",
        )

    before = {
        "paymongo_refund_status": txn.paymongo_refund_status,
        "paymongo_refund_id": txn.paymongo_refund_id,
    }
    try:
        refund = paymongo.create_refund(
            payment_id=str(txn.paymongo_payment_id),
            amount_centavos=money.to_centavos(txn.amount),
            notes=f"Carabao order {order_ref(txn)}, transaction {txn.id}",
            metadata={"transaction_id": str(txn.id), "order_id": str(txn.order_id)},
        )
    except paymongo.RefundRejected as exc:
        logger.warning("PayMongo refused refund of txn %s: %s", txn.id, exc.codes)
        txn.paymongo_refund_status = PAYMONGO_FAILED
        txn.refund_failure_reason = str(exc)[:FAILURE_REASON_MAX] or "Refused"
    except paymongo.RefundOutcomeUnknown as exc:
        logger.error("PayMongo refund of txn %s: no answer (%s)", txn.id, exc.codes)
        txn.paymongo_refund_status = PAYMONGO_UNKNOWN
        txn.refund_failure_reason = (
            "PayMongo did not answer. Check the PayMongo dashboard for a refund "
            f"of {txn.paymongo_payment_id} before doing anything else."
        )
    except RuntimeError as exc:  # no secret key: nothing was sent
        db.rollback()
        raise RefundError(503, "PayMongo is not configured") from exc
    else:
        txn.paymongo_refund_id = refund["id"]
        txn.refunded_by = admin.id
        txn.refund_failure_reason = None
        _apply_refund(db, txn, refund, admin=admin)

    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.REFUND_SENT,
        target_type="transaction",
        target_id=txn.id,
        before=before,
        after={
            "amount": txn.amount,
            "paymongo_refund_id": txn.paymongo_refund_id,
            "paymongo_refund_status": txn.paymongo_refund_status,
            "status": txn.status,
            "refund_failure_reason": txn.refund_failure_reason,
        },
    )
    db.commit()
    db.refresh(txn)
    if txn.status == TransactionStatus.REFUNDED:
        notify_buyer_refunded(txn)
    return txn


def _apply_refund(
    db: Session, txn: Transaction, refund: dict, *, admin: User | None
) -> bool:
    """Bring the transaction in line with PayMongo's refund object.
    Returns True when it became refunded. The caller commits."""
    if txn.status != TransactionStatus.REFUND_PENDING:
        return False
    attrs = refund.get("attributes") or {}
    status = str(attrs.get("status") or "").lower()
    if status in _SUCCEEDED:
        _mark_refunded(
            db,
            txn,
            admin=admin,
            method="paymongo",
            reference=str(refund.get("id") or txn.paymongo_refund_id or ""),
            notes=txn.refund_notes,
        )
        return True
    if status in _FAILED:
        txn.paymongo_refund_status = PAYMONGO_FAILED
        txn.refund_failure_reason = (
            str(attrs.get("failure_reason") or attrs.get("notes") or "")
            or "PayMongo could not complete the refund."
        )[:FAILURE_REASON_MAX]
        return False
    # pending, processing, refunding (QR Ph: waiting for the buyer to claim it)
    txn.paymongo_refund_status = PAYMONGO_PROCESSING
    return False


def refresh_paymongo_refund(
    db: Session, *, transaction_id: int, admin: User
) -> Transaction:
    """Ask PayMongo for the sent refund's status (a missed webhook)."""
    txn = _locked(db, transaction_id)
    if txn.paymongo_refund_status != PAYMONGO_PROCESSING or not txn.paymongo_refund_id:
        raise RefundError(409, "No PayMongo refund is in progress for this payment")
    try:
        refund = paymongo.get_refund(str(txn.paymongo_refund_id))
    except (requests.RequestException, KeyError, ValueError) as exc:
        db.rollback()
        logger.warning(
            "PayMongo refund refresh failed for txn %s: %s",
            transaction_id,
            describe_error(exc),
        )
        raise RefundError(502, "Could not reach PayMongo. Try again.") from exc
    except RuntimeError as exc:
        db.rollback()
        raise RefundError(503, "PayMongo is not configured") from exc
    refunded = _apply_refund(db, txn, refund, admin=admin)
    db.commit()
    db.refresh(txn)
    if refunded:
        notify_buyer_refunded(txn)
    return txn


def _txn_for_refund(db: Session, refund: dict) -> Transaction | None:
    """Our transaction for a PayMongo refund: by refund id, else by the
    transaction id we put in its metadata (also settles an ``unknown`` one)."""
    refund_id = refund.get("id")
    attrs = refund.get("attributes") or {}
    if refund_id:
        txn = (
            db.query(Transaction)
            .filter(Transaction.paymongo_refund_id == refund_id)
            .with_for_update()
            .first()
        )
        if txn is not None:
            return txn
    txn_id = str((attrs.get("metadata") or {}).get("transaction_id") or "")
    if not txn_id.isdigit():
        return None
    txn = (
        db.query(Transaction)
        .filter(Transaction.id == int(txn_id))
        .with_for_update()
        .first()
    )
    # Only when it refunds that transaction's payment: metadata is not proof.
    if txn is None or not txn.paymongo_payment_id:
        return None
    if txn.paymongo_payment_id != attrs.get("payment_id"):
        return None
    if refund_id and not txn.paymongo_refund_id:
        txn.paymongo_refund_id = refund_id
    return txn


def handle_refund_event(db: Session, resource: dict[str, Any]) -> None:
    """A ``payment.refund.updated`` or ``payment.refunded`` webhook.

    The data is a refund; for payment.refunded it may be the payment, and the
    refund we sent for it is read from PayMongo.
    """
    if resource.get("type") == "payment":
        payment_id = resource.get("id")
        txn = (
            db.query(Transaction)
            .filter(
                Transaction.paymongo_payment_id == payment_id,
                Transaction.status == TransactionStatus.REFUND_PENDING,
                Transaction.paymongo_refund_id.isnot(None),
            )
            .with_for_update()
            .first()
            if payment_id
            else None
        )
        if txn is None:
            logger.info("payment.refunded for %s: no refund in progress", payment_id)
            return
        try:
            resource = paymongo.get_refund(str(txn.paymongo_refund_id))
        except Exception as exc:  # noqa: BLE001 - the refresh button recovers
            db.rollback()
            logger.warning(
                "Could not read the refund of txn %s: %s", txn.id, describe_error(exc)
            )
            return
    else:
        txn = _txn_for_refund(db, resource)
        if txn is None:
            logger.warning("No transaction for PayMongo refund %s", resource.get("id"))
            return

    refunded = _apply_refund(db, txn, resource, admin=None)
    db.commit()
    logger.info(
        "Refund webhook: txn %s -> %s (%s)",
        txn.id,
        txn.status,
        txn.paymongo_refund_status,
    )
    if refunded:
        db.refresh(txn)
        notify_buyer_refunded(txn)


def notify_buyer_refunded(txn: Transaction) -> None:
    """Email and SMS the buyer. Never raises: the refund is already recorded."""
    buyer = txn.user
    if buyer is None:
        return
    ref = order_ref(txn)
    method = REFUND_METHODS.get(txn.refund_method or "", txn.refund_method or "")

    if buyer.verified_email and notifications.wants(buyer, "email"):
        try:
            email.send_refund_email(
                buyer.verified_email,
                order_ref=ref,
                amount=txn.amount,
                method=method,
                reference=txn.refund_reference or "",
            )
        except Exception as exc:  # noqa: BLE001 - email provider errors vary
            logger.warning(
                "[email] Could not send refund email for %s: %s",
                ref,
                describe_error(exc),
            )

    if buyer.phone_number and notifications.wants(buyer, "sms"):
        message = (
            f"Carabao: PHP {txn.amount:,} for order {ref} was refunded via "
            f"{method}. Ref: {txn.refund_reference}"
        )
        try:
            send_sms(number=buyer.phone_number, message=message)
        except SemaphoreError as exc:
            logger.warning("[sms] Could not send refund SMS for %s: %s", ref, exc)

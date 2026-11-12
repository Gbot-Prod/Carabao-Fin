"""Admin-recorded refunds (A2).

A paid transaction becomes ``refund_pending`` when its order is cancelled or a
payment lands on a closed order. The money is returned outside the system
(PayMongo dashboard, GCash, bank transfer, ...); the admin then records the
method and reference here and the transaction becomes ``refunded``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.integrations.sms.semaphore import SemaphoreError, send_sms
from app.models.statuses import TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.services import audit_log, email, notifications

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
    year = order.ordered_at.year if order is not None and order.ordered_at else "XXXX"
    return f"CB-{year}-{txn.order_id:04d}"


def record_refund(
    db: Session,
    *,
    transaction_id: int,
    admin: User,
    method: str,
    reference: str,
    notes: str | None = None,
) -> Transaction:
    if method not in REFUND_METHODS:
        raise RefundError(422, "Unknown refund method")
    reference = reference.strip()
    if not reference:
        raise RefundError(422, "A refund reference is required")

    txn = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id)
        .with_for_update()
        .first()
    )
    if txn is None:
        raise RefundError(404, "Transaction not found")
    if txn.status != TransactionStatus.REFUND_PENDING:
        raise RefundError(409, f"Transaction is {txn.status}, not refund_pending")

    before = {"status": txn.status}
    txn.status = TransactionStatus.REFUNDED
    txn.refund_method = method
    txn.refund_reference = reference
    txn.refund_notes = (notes or "").strip() or None
    txn.refunded_at = datetime.now(UTC)
    txn.refunded_by = admin.id
    notifications.notify(
        db, txn.user_id, notifications.REFUND,
        f"Refund sent for {order_ref(txn)}", f"PHP {txn.amount:,} via {REFUND_METHODS[method]}.",
        f"/orders/{txn.order_id}",
    )
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.REFUND,
        target_type="transaction",
        target_id=txn.id,
        before=before,
        after={
            "status": txn.status,
            "amount": txn.amount,
            "refund_method": txn.refund_method,
            "refund_reference": txn.refund_reference,
            "refund_notes": txn.refund_notes,
        },
    )
    db.commit()
    db.refresh(txn)
    notify_buyer_refunded(txn)
    return txn


def notify_buyer_refunded(txn: Transaction) -> None:
    """Email and SMS the buyer. Never raises: the refund is already recorded."""
    buyer = txn.user
    if buyer is None:
        return
    ref = order_ref(txn)
    method = REFUND_METHODS.get(txn.refund_method or "", txn.refund_method or "")

    if buyer.email and notifications.wants(buyer, "email"):
        try:
            email.send_refund_email(
                buyer.email,
                order_ref=ref,
                amount=txn.amount,
                method=method,
                reference=txn.refund_reference or "",
            )
        except Exception as exc:  # noqa: BLE001 - email provider errors vary
            logger.warning("[email] Could not send refund email for %s: %s", ref, exc)

    if buyer.phone_number and notifications.wants(buyer, "sms"):
        message = (
            f"Carabao: PHP {txn.amount:,} for order {ref} was refunded via "
            f"{method}. Ref: {txn.refund_reference}"
        )
        try:
            send_sms(number=buyer.phone_number, message=message)
        except SemaphoreError as exc:
            logger.warning("[sms] Could not send refund SMS for %s: %s", ref, exc)

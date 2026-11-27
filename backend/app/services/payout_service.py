"""Merchant payouts: who is owed what, where it goes, and sending it.

A payout batch is created when a merchant cashes out. An admin sends it, which
makes one PayMongo InstaPay transfer from the platform
wallet to the merchant's bank or e-wallet. The transfer settles asynchronously:
the batch stays ``processing`` until PayMongo's webhook (or a status refresh) says it
succeeded (``released``) or failed (``failed``, which an admin can resend).

Sending is guarded so money never goes out twice: the batch is locked and
moved to ``processing`` (and committed) before PayMongo is called, and a
``processing`` batch cannot be sent again.

No tax is withheld from payouts: BIR RR No. 16-2023 (0.5% e-marketplace
withholding) was declared void by the CTA on October 22, 2026 (CTA Case No.
SCA-0027). Revisit if the ruling is reversed on appeal.
"""

import logging
import os
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.order_proof_photo import OrderProofPhoto
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.statuses import (
    OrderStatus,
    PayoutDestinationVerificationStatus,
    PayoutStatus,
    TransactionStatus,
)
from app.models.transaction import Transaction
from app.services import money, notifications, paymongo
from app.services.merchant_verification import merchant_can_request_payout
from app.services.order_status import auto_confirm_due

logger = logging.getLogger(__name__)

# Institution codes for the e-wallets (PayMongo's receiving list).
EWALLET_INSTITUTIONS = {
    "gcash": ("GXCHPHM2XXX", "GCash"),
    "maya": ("PAPHPHM1XXX", "Maya"),
}
# Every destination (GCash too) goes by InstaPay, which settles in minutes.
# PESONet stays as a provider value for batches sent before this change.
# GCash refuses transfers below ₱10 (AC06 BlockedAccount), so no payout sends
# less than MIN_TRANSFER_PESOS.
MIN_TRANSFER_PESOS = 10
PROVIDER_MAX_PESOS = {"instapay": 50_000, "pesonet": 10_000_000}
PROVIDER_LABELS = {"instapay": "InstaPay", "pesonet": "PESONet"}

_BIC_RE = re.compile(r"^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$")
_MOBILE_RE = re.compile(r"^09\d{9}$")


class PayoutError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class Destination:
    type: str  # bank | gcash | maya
    bic: str
    institution: str
    name: str
    number: str

    @property
    def provider(self) -> str:
        return "instapay"

    def as_paymongo(self) -> dict[str, str]:
        return {"number": self.number, "name": self.name, "bic": self.bic}


def transfer_fee() -> int:
    """Pesos taken from each payout to cover PayMongo's transfer fee."""
    return int(os.getenv("PAYOUT_TRANSFER_FEE", "10"))


def normalize_mobile(number: str | None) -> str | None:
    """+63 917 123 4567 / 639171234567 / 9171234567 -> 09171234567."""
    if not number:
        return None
    digits = re.sub(r"\D", "", number)
    if digits.startswith("63"):
        digits = "0" + digits[2:]
    elif digits.startswith("9") and len(digits) == 10:
        digits = "0" + digits
    return digits


def is_valid_bic(code: str | None) -> bool:
    return bool(code and _BIC_RE.match(code))


def is_valid_mobile(number: str | None) -> bool:
    return bool(number and _MOBILE_RE.match(number))


def payout_info_problem(info: MerchantPayoutInfo | None) -> str | None:
    """Why this payout method can't be sent to yet, or None when it can."""
    if info is None:
        return "Set up your payout method first."
    if not (info.account_name or "").strip():
        return "Add the account holder's name."
    if info.payout_type == "bank":
        if not is_valid_bic(info.bank_code):
            return "Pick your bank from the list again."
        if not (info.account_number or "").strip():
            return "Add your bank account number."
        return None
    if info.payout_type in EWALLET_INSTITUTIONS:
        if not is_valid_mobile(info.ewallet_number):
            return "Enter a mobile number like 09171234567."
        return None
    return "Unsupported payout method."


def resolve_destination(info: MerchantPayoutInfo | None) -> Destination:
    problem = payout_info_problem(info)
    # CF-0089: a None problem means every field below is set and valid.
    if problem or info is None:
        raise PayoutError(400, f"Merchant payout method is incomplete: {problem}")
    if info.payout_type == "bank":
        return Destination(
            type="bank",
            bic=info.bank_code or "",
            institution=info.bank_name or info.bank_code or "",
            name=(info.account_name or "").strip(),
            number=(info.account_number or "").strip(),
        )
    bic, institution = EWALLET_INSTITUTIONS[info.payout_type]
    return Destination(
        type=info.payout_type,
        bic=bic,
        institution=institution,
        name=(info.account_name or "").strip(),
        number=info.ewallet_number or "",
    )


def save_destination(batch: PayoutBatch, destination: Destination) -> None:
    """Fix where ``batch`` will be sent (CF-0004). Called when it is requested."""
    batch.destination_type = destination.type
    batch.destination_bic = destination.bic
    batch.destination_institution = destination.institution
    batch.destination_name = destination.name
    batch.destination_number = destination.number
    batch.transfer_provider = destination.provider


def saved_destination(batch: PayoutBatch) -> Destination | None:
    """The destination saved on ``batch``, or None if it has none."""
    if not (
        batch.destination_type
        and batch.destination_bic
        and batch.destination_name
        and batch.destination_number
    ):
        return None
    return Destination(
        type=batch.destination_type,
        bic=batch.destination_bic,
        institution=batch.destination_institution or batch.destination_bic,
        name=batch.destination_name,
        number=batch.destination_number,
    )


def move_failed_batches(
    db: Session, merchant_id: int, destination: Destination
) -> list[int]:
    """Point the merchant's failed batches at a new, code-confirmed destination.

    Only failed ones: a pending or processing batch keeps the destination it
    was requested with. Returns the ids moved; the caller commits.
    """
    batches = (
        db.query(PayoutBatch)
        .filter(
            PayoutBatch.merchant_id == merchant_id,
            PayoutBatch.status == PayoutStatus.FAILED,
        )
        .with_for_update()
        .all()
    )
    for batch in batches:
        save_destination(batch, destination)
    return [batch.id for batch in batches]


def get_payout_info(db: Session, merchant_id: int) -> MerchantPayoutInfo | None:
    return (
        db.query(MerchantPayoutInfo)
        .filter(MerchantPayoutInfo.merchant_id == merchant_id)
        .first()
    )


def dispute_hours() -> int:
    """Hours a buyer has to dispute a merchant-set delivery (no flags)."""
    return int(os.getenv("DELIVERY_DISPUTE_HOURS", "48"))


# ORDER_PROOF_PHOTOS_PLAN.md: buyers can dispute a merchant-set delivery
# (Phase 2), so one with no flags is payable after the 48 h hold. False makes
# every merchant-set delivery count as flagged (no early payout).
BUYER_DISPUTES_LIVE = True


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def delivery_payable(
    order: Order, dropoff_flags: list[str] | None, now: datetime | None = None
) -> bool:
    """Whether a delivered order's earnings may be paid out now.

    A buyer or auto confirm: at once. A merchant-set delivery (drop-off
    photo): when the buyer confirmed it, when an admin released a dispute, or
    else after the hold unless a dispute is open. The hold is
    DELIVERY_DISPUTE_HOURS after delivery with no flags, and the auto-confirm
    time (7 days from shipping) with flags.
    """
    if order.delivery_confirmed_by != "merchant":
        return True
    if order.dispute_resolution == "release":
        return True
    if order.delivery_disputed_at is not None or order.dispute_resolution:
        return False
    if order.delivery_buyer_confirmed_at is not None:
        return True
    now = now or datetime.now(UTC)
    flagged = bool(dropoff_flags) or not BUYER_DISPUTES_LIVE
    if flagged:
        due = auto_confirm_due(order)
    else:
        due = (
            _aware(order.delivered_at) + timedelta(hours=dispute_hours())
            if order.delivered_at
            else None
        )
    return due is not None and _aware(due) <= now


def claimable_transactions(db: Session, merchant_id: int) -> list[Transaction]:
    """Paid transactions of delivered, payable orders that no payout batch
    holds yet (delivery_payable).

    A failed batch keeps its transactions (it is resent, not rebuilt), so any
    batch, whatever its status, claims them.
    """
    batched_ids = db.query(PayoutBatchItem.transaction_id).scalar_subquery()
    rows = (
        db.query(Transaction, Order)
        .join(Order, Order.id == Transaction.order_id)
        .filter(
            Transaction.merchant_id == merchant_id,
            Transaction.status == TransactionStatus.PAID,
            Order.status == OrderStatus.DELIVERED,
            Order.delivered_at.isnot(None),
            Transaction.id.not_in(batched_ids),
        )
        .all()
    )
    merchant_set = [
        order.id for _, order in rows if order.delivery_confirmed_by == "merchant"
    ]
    flags_by_order = (
        dict(
            db.query(OrderProofPhoto.order_id, OrderProofPhoto.flags).filter(
                OrderProofPhoto.order_id.in_(merchant_set),
                OrderProofPhoto.kind == "dropoff",
            )
        )
        if merchant_set
        else {}
    )
    now = datetime.now(UTC)
    return [
        txn
        for txn, order in rows
        if delivery_payable(order, flags_by_order.get(order.id), now)
    ]


def fit_to_transfer_limit(
    txns: list[Transaction], provider: str, fee: int
) -> list[Transaction]:
    """The oldest transactions whose payout, after ``fee``, one transfer can send.

    InstaPay sends at most ₱50,000 per transfer (CF-0046). A batch above the
    limit could never be sent and would block every later request, so the
    request takes what fits; the rest stays claimable for the next payout.
    """
    cap = PROVIDER_MAX_PESOS[provider]
    chosen: list[Transaction] = []
    total = 0
    for txn in sorted(txns, key=lambda t: (t.paid_at or t.created_at, t.id)):
        if total + txn.merchant_amount - fee <= cap:
            chosen.append(txn)
            total += txn.merchant_amount
    return chosen


def _mark_failed(batch: PayoutBatch, reason: str) -> None:
    batch.status = PayoutStatus.FAILED
    batch.failure_reason = reason[:1000]


def send_payout(db: Session, batch_id: int, notes: str | None = None) -> PayoutBatch:
    """Send a pending or failed batch to the merchant through PayMongo."""
    batch = (
        db.query(PayoutBatch)
        .filter(PayoutBatch.id == batch_id)
        .with_for_update()
        .first()
    )
    if batch is None:
        raise PayoutError(404, "Batch not found")
    if batch.status == PayoutStatus.RELEASED:
        raise PayoutError(400, "Batch already released")
    if batch.status == PayoutStatus.PROCESSING:
        raise PayoutError(
            409, "This payout is already being sent. Refresh its status instead."
        )

    # Defence in depth: requests already refuse an unverified merchant.
    if not merchant_can_request_payout(db.get(Merchant, batch.merchant_id)):
        raise PayoutError(403, "This merchant is not verified to receive payouts")

    info = get_payout_info(db, batch.merchant_id)
    if (
        info is None
        or info.verification_status != PayoutDestinationVerificationStatus.VERIFIED
    ):
        raise PayoutError(
            403, "This merchant's payout destination is not verified yet"
        )

    # CF-0004: the destination saved when the payout was requested, never the
    # merchant's current payout method.
    destination = saved_destination(batch)
    if destination is None:
        raise PayoutError(
            409,
            "This payout has no saved destination. The merchant must request it again.",
        )
    fee = transfer_fee()
    net = batch.gross_amount - fee
    if net < MIN_TRANSFER_PESOS:
        raise PayoutError(
            400,
            f"Payout of ₱{batch.gross_amount} less the ₱{fee} fee is below the "
            f"₱{MIN_TRANSFER_PESOS} minimum transfer",
        )
    provider = destination.provider
    if net > PROVIDER_MAX_PESOS[provider]:
        raise PayoutError(
            400,
            f"{PROVIDER_LABELS[provider]} sends at most "
            f"₱{PROVIDER_MAX_PESOS[provider]:,} per transfer",
        )

    # Claim the batch before any money moves, so a second click (or a crash
    # mid-call) can never send it twice.
    batch.attempts = (batch.attempts or 0) + 1
    # The random part keeps the reference unique even when batch ids start
    # again (a database reset). PayMongo returns its earlier transfer for a
    # reused reference instead of sending a new one.
    batch.paymongo_reference = (
        f"CARABAO-PAYOUT-{batch.id}-{batch.attempts}-{secrets.token_hex(4).upper()}"
    )
    batch.paymongo_transfer_id = None
    batch.provider_reference = None
    batch.failure_reason = None
    batch.transfer_fee = fee
    batch.net_amount = net
    batch.transfer_provider = provider
    sent_at = datetime.now(UTC)
    batch.sent_at = sent_at
    batch.status = PayoutStatus.PROCESSING
    if notes:
        batch.notes = notes
    db.commit()

    try:
        transfer = paymongo.create_transfer(
            amount_centavos=money.to_centavos(net),
            destination=destination.as_paymongo(),
            provider=provider,
            reference_number=batch.paymongo_reference,
            description=f"Carabao payout #{batch.id}",
            metadata={"payout_batch_id": str(batch.id)},
        )
    except paymongo.TransferRejected as exc:
        # CF-0074: codes only; the detail (kept in failure_reason) can hold
        # the destination account number or name.
        logger.warning(
            "Payout batch %s rejected by PayMongo: %s", batch.id, exc.codes or "-"
        )
        _mark_failed(batch, f"PayMongo rejected the transfer: {exc}")
        db.commit()
        return batch
    except paymongo.TransferOutcomeUnknown as exc:
        logger.error("Payout batch %s outcome unknown: %s", batch.id, exc.codes or "-")
        batch.failure_reason = (
            f"No clear answer from PayMongo ({exc}). Left as processing until "
            "PayMongo's webhook reports the result; do not resend."
        )[:1000]
        db.commit()
        return batch

    created = _transfer_created_at(transfer)
    if created is not None and created < sent_at - _OLD_TRANSFER_SLACK:
        # Backstop: an old transfer came back, so nothing new was sent.
        logger.error(
            "Payout batch %s got back older transfer %s", batch.id, transfer.get("id")
        )
        _mark_failed(
            batch,
            "PayMongo returned an older transfer for this reference. No money "
            "moved; send it again.",
        )
        db.commit()
        return batch

    batch.paymongo_transfer_id = transfer.get("id")
    apply_transfer_status(
        batch,
        status=transfer.get("status"),
        provider_reference=transfer.get("provider_reference_number"),
    )
    db.commit()
    logger.info(
        "Payout batch %s sent as %s (%s)",
        batch.id,
        batch.paymongo_transfer_id,
        transfer.get("status"),
    )
    return batch


_OLD_TRANSFER_SLACK = timedelta(minutes=10)  # allows for clock difference


def _transfer_created_at(transfer: dict[str, Any]) -> datetime | None:
    """PayMongo's created_at as an aware datetime (Unix seconds or ISO 8601)."""
    value = transfer.get("created_at")
    try:
        if isinstance(value, int | float) and not isinstance(value, bool):
            return datetime.fromtimestamp(value, UTC)
        if isinstance(value, str) and value:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
    except (ValueError, OverflowError, OSError):
        return None
    return None


def apply_transfer_status(
    batch: PayoutBatch,
    *,
    status: str | None,
    provider_reference: str | None = None,
    error: str | None = None,
    error_code: str | None = None,
) -> None:
    """Move a batch to match its PayMongo transfer's status (idempotent)."""
    if provider_reference:
        batch.provider_reference = provider_reference
    if status == "succeeded":
        if batch.status != PayoutStatus.RELEASED:
            batch.status = PayoutStatus.RELEASED
            batch.released_at = datetime.now(UTC)
            batch.failure_reason = None
            merchant = batch.merchant
            notifications.notify(
                batch,
                merchant.user_id if merchant is not None else None,
                notifications.PAYOUT_RELEASED,
                "Payout sent",
                f"PHP {(batch.net_amount or batch.gross_amount):,} is on its way "
                "to your account.",
                "/merchantDashboard",
            )
    elif status == "failed":
        if batch.status == PayoutStatus.RELEASED:
            logger.error(
                "Transfer for released payout batch %s reported failed", batch.id
            )
            return
        reason = " - ".join(p for p in (error_code, error) if p)
        _mark_failed(batch, reason or "Transfer failed at the receiving bank")


def _error_message(transfer: dict[str, Any]) -> str | None:
    # The v2 transfer object says provider_error_message; webhook docs show
    # provider_error.
    return transfer.get("provider_error_message") or transfer.get("provider_error")


def refresh_payout(db: Session, batch_id: int) -> PayoutBatch:
    """Ask PayMongo for the latest status of a batch's transfer."""
    batch = db.query(PayoutBatch).filter(PayoutBatch.id == batch_id).first()
    if batch is None:
        raise PayoutError(404, "Batch not found")
    if not batch.paymongo_transfer_id:
        raise PayoutError(
            409,
            "PayMongo never returned a transfer id for this batch; "
            "wait for its webhook or check the PayMongo dashboard.",
        )
    transfer = paymongo.get_transfer(batch.paymongo_transfer_id)
    apply_transfer_status(
        batch,
        status=transfer.get("status"),
        provider_reference=transfer.get("provider_reference_number"),
        error=_error_message(transfer),
        error_code=transfer.get("provider_error_code"),
    )
    db.commit()
    db.refresh(batch)
    return batch


def handle_transfer_event(
    db: Session, event_type: str, resource: dict[str, Any]
) -> None:
    """Apply a ``transfer.outward.*`` webhook to its verification attempt or payout batch."""
    from app.services.payout_verification import handle_verification_transfer_event

    if handle_verification_transfer_event(db, event_type, resource):
        return

    attrs = resource.get("attributes") or resource
    transfer_id = attrs.get("transfer_id") or resource.get("id")
    reference = attrs.get("reference_number")
    status = attrs.get("status") or (
        "succeeded" if event_type.endswith("successful") else "failed"
    )

    batch = None
    if transfer_id:
        batch = (
            db.query(PayoutBatch)
            .filter(PayoutBatch.paymongo_transfer_id == transfer_id)
            .first()
        )
    if batch is None and reference:
        batch = (
            db.query(PayoutBatch)
            .filter(PayoutBatch.paymongo_reference == reference)
            .first()
        )
    if batch is None:
        logger.warning(
            "No payout batch for transfer %s (reference %s)", transfer_id, reference
        )
        return

    if transfer_id and not batch.paymongo_transfer_id:
        batch.paymongo_transfer_id = transfer_id
    apply_transfer_status(
        batch,
        status=status,
        provider_reference=attrs.get("provider_reference_number"),
        error=_error_message(attrs),
        error_code=attrs.get("provider_error_code"),
    )
    db.commit()
    logger.info("Payout batch %s -> %s via %s", batch.id, batch.status, event_type)

"""Merchant payouts: who is owed what, where it goes, and sending it.

A payout batch is created when a merchant cashes out. An admin sends it, which
makes one PayMongo transfer (InstaPay, or PESONet for GCash) from the platform
wallet to the merchant's bank or e-wallet. The transfer settles asynchronously: the batch stays
``processing`` until PayMongo's webhook (or a status refresh) says it
succeeded (``released``) or failed (``failed``, which an admin can resend).

Sending is guarded so money never goes out twice: the batch is locked and
moved to ``processing`` (and committed) before PayMongo is called, and a
``processing`` batch cannot be sent again.
"""

import logging
import os
import re
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.statuses import OrderStatus, PayoutStatus, TransactionStatus
from app.models.transaction import Transaction
from app.services import notifications, paymongo

logger = logging.getLogger(__name__)

# Institution codes for the e-wallets (PayMongo's receiving list).
EWALLET_INSTITUTIONS = {
    "gcash": ("GXCHPHM2XXX", "GCash"),
    "maya": ("PAPHPHM1XXX", "Maya"),
}
# GCash refuses InstaPay transfers from PayMongo wallets (AC06 BlockedAccount)
# but accepts PESONet, so it always goes by PESONet. Everything else uses
# InstaPay, which settles in minutes instead of on banking-day cycles.
PESONET_ONLY_BICS = frozenset({"GXCHPHM2XXX"})
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
        return "pesonet" if self.bic in PESONET_ONLY_BICS else "instapay"

    def as_paymongo(self) -> dict:
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


def payout_info_problem(info) -> str | None:
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


def resolve_destination(info) -> Destination:
    problem = payout_info_problem(info)
    if problem:
        raise PayoutError(400, f"Merchant payout method is incomplete: {problem}")
    if info.payout_type == "bank":
        return Destination(
            type="bank",
            bic=info.bank_code,
            institution=info.bank_name or info.bank_code,
            name=info.account_name.strip(),
            number=info.account_number.strip(),
        )
    bic, institution = EWALLET_INSTITUTIONS[info.payout_type]
    return Destination(
        type=info.payout_type,
        bic=bic,
        institution=institution,
        name=info.account_name.strip(),
        number=info.ewallet_number,
    )


def get_payout_info(db: Session, merchant_id: int) -> MerchantPayoutInfo | None:
    return (
        db.query(MerchantPayoutInfo)
        .filter(MerchantPayoutInfo.merchant_id == merchant_id)
        .first()
    )


def claimable_transactions(db: Session, merchant_id: int) -> list[Transaction]:
    """Paid transactions of delivered orders that no payout batch holds yet.

    A failed batch keeps its transactions (it is resent, not rebuilt), so any
    batch, whatever its status, claims them.
    """
    batched_ids = db.query(PayoutBatchItem.transaction_id).scalar_subquery()
    return (
        db.query(Transaction)
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

    destination = resolve_destination(get_payout_info(db, batch.merchant_id))
    fee = transfer_fee()
    net = batch.gross_amount - fee
    if net <= 0:
        raise PayoutError(
            400, f"Payout of ₱{batch.gross_amount} does not cover the ₱{fee} fee"
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
    batch.paymongo_reference = f"CARABAO-PAYOUT-{batch.id}-{batch.attempts}"
    batch.paymongo_transfer_id = None
    batch.provider_reference = None
    batch.failure_reason = None
    batch.transfer_fee = fee
    batch.net_amount = net
    batch.destination_type = destination.type
    batch.destination_bic = destination.bic
    batch.destination_name = destination.name
    batch.destination_number = destination.number
    batch.transfer_provider = provider
    batch.sent_at = datetime.now(UTC)
    batch.status = PayoutStatus.PROCESSING
    if notes:
        batch.notes = notes
    db.commit()

    try:
        transfer = paymongo.create_transfer(
            amount_centavos=net * 100,
            destination=destination.as_paymongo(),
            provider=provider,
            reference_number=batch.paymongo_reference,
            description=f"Carabao payout #{batch.id}",
            metadata={"payout_batch_id": str(batch.id)},
        )
    except paymongo.TransferRejected as exc:
        logger.warning("Payout batch %s rejected by PayMongo: %s", batch.id, exc)
        _mark_failed(batch, f"PayMongo rejected the transfer: {exc}")
        db.commit()
        return batch
    except paymongo.TransferOutcomeUnknown as exc:
        logger.error("Payout batch %s outcome unknown: %s", batch.id, exc)
        batch.failure_reason = (
            f"No clear answer from PayMongo ({exc}). Left as processing until "
            "PayMongo's webhook reports the result; do not resend."
        )[:1000]
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
                f"PHP {(batch.net_amount or batch.gross_amount):,} is on its way to your account.",
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


def _error_message(transfer: dict) -> str | None:
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


def handle_transfer_event(db: Session, event_type: str, resource: dict) -> None:
    """Apply a ``transfer.outward.*`` webhook to its payout batch."""
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

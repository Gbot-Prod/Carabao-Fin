"""Penny-drop verification for merchant payout destinations.

Sends a small PayMongo InstaPay transfer (₱10.01–₱10.99, above GCash's ₱10
minimum) to the saved destination and requires the merchant to confirm the
exact centavos received before payouts can be requested or sent.
"""

from __future__ import annotations

import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.models.merchant_payout import MerchantPayoutInfo, PayoutVerificationAttempt
from app.models.statuses import (
    PayoutDestinationVerificationStatus,
    PayoutVerificationAttemptStatus,
)
from app.services import paymongo, payout_otp
from app.services.payout_service import (
    PayoutError,
    move_failed_batches,
    payout_info_problem,
    resolve_destination,
)

logger = logging.getLogger(__name__)

PENNY_DROP_MIN_CENTAVOS = 1001  # ₱10.01 (above MIN_TRANSFER_PESOS = 10)
PENNY_DROP_MAX_CENTAVOS = 1099  # ₱10.99 (+ ₱10 fee ≈ ₱20.01–₱20.99)
PENNY_DROP_MAX_MONTHLY_ATTEMPTS = 3
PENNY_DROP_EXPIRY_HOURS = 72
PENNY_DROP_MAX_GUESSES = 5

_V = PayoutDestinationVerificationStatus
_A = PayoutVerificationAttemptStatus
_OPEN_ATTEMPT_STATUSES = (_A.SENDING, _A.SENT, _A.SETTLED)
_CONFIRMABLE_ATTEMPT_STATUSES = (_A.SENT, _A.SETTLED)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def info_fingerprint(info: MerchantPayoutInfo) -> str:
    """Canonical fingerprint of a ``MerchantPayoutInfo`` destination."""
    return payout_otp.fingerprint(
        {
            "payout_type": info.payout_type,
            "bank_code": info.bank_code,
            "account_number": info.account_number,
            "account_name": info.account_name,
            "ewallet_number": info.ewallet_number,
        }
    )


def reset_verification(db: Session, info: MerchantPayoutInfo) -> None:
    """Clear verification state when a destination is created or changed."""
    info.verification_status = _V.UNVERIFIED
    info.verification_method = None
    info.verified_at = None
    info.verification_error = None
    (
        db.query(PayoutVerificationAttempt)
        .filter(
            PayoutVerificationAttempt.merchant_id == info.merchant_id,
            PayoutVerificationAttempt.status.in_(_OPEN_ATTEMPT_STATUSES),
        )
        .update({"status": _A.EXPIRED}, synchronize_session=False)
    )


def start_penny_drop(db: Session, merchant_id: int) -> PayoutVerificationAttempt:
    """Send a ₱10.01–₱10.99 penny-drop transfer to verify the saved destination."""
    info = (
        db.query(MerchantPayoutInfo)
        .filter(MerchantPayoutInfo.merchant_id == merchant_id)
        .with_for_update()
        .first()
    )
    problem = payout_info_problem(info)
    if problem or info is None:
        raise PayoutError(400, problem or "Set up your payout method first.")
    if info.verification_status == _V.VERIFIED:
        raise PayoutError(409, "This payout destination is already verified.")

    fp = info_fingerprint(info)
    now = datetime.now(UTC)
    existing = (
        db.query(PayoutVerificationAttempt)
        .filter(
            PayoutVerificationAttempt.merchant_id == merchant_id,
            PayoutVerificationAttempt.destination_fingerprint == fp,
            PayoutVerificationAttempt.status.in_(_OPEN_ATTEMPT_STATUSES),
        )
        .order_by(PayoutVerificationAttempt.id.desc())
        .first()
    )
    if existing is not None and _aware(existing.expires_at) > now:
        raise PayoutError(
            409,
            "A verification transfer is already on its way. Enter the exact "
            "amount received to confirm it.",
        )

    month_ago = now - timedelta(days=30)
    monthly_count = (
        db.query(PayoutVerificationAttempt)
        .filter(
            PayoutVerificationAttempt.merchant_id == merchant_id,
            PayoutVerificationAttempt.created_at >= month_ago,
        )
        .count()
    )
    if monthly_count >= PENNY_DROP_MAX_MONTHLY_ATTEMPTS:
        raise PayoutError(
            429,
            f"You have reached the limit of {PENNY_DROP_MAX_MONTHLY_ATTEMPTS} "
            "verification transfers in 30 days. Contact support for help.",
        )

    destination = resolve_destination(info)
    amount_centavos = PENNY_DROP_MIN_CENTAVOS + secrets.randbelow(
        PENNY_DROP_MAX_CENTAVOS - PENNY_DROP_MIN_CENTAVOS + 1
    )
    attempt = PayoutVerificationAttempt(
        merchant_id=merchant_id,
        destination_fingerprint=fp,
        amount_centavos=amount_centavos,
        paymongo_reference=(
            f"CARABAO-VERIFY-{merchant_id}-{secrets.token_hex(6).upper()}"
        ),
        status=_A.SENDING,
        attempts_remaining=PENNY_DROP_MAX_GUESSES,
        expires_at=now + timedelta(hours=PENNY_DROP_EXPIRY_HOURS),
    )
    info.verification_status = _V.PENDING
    info.verification_error = None
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    try:
        transfer = paymongo.create_transfer(
            amount_centavos=attempt.amount_centavos,
            destination=destination.as_paymongo(),
            provider=destination.provider,
            reference_number=attempt.paymongo_reference,
            description="Carabao payout verification",
            metadata={"verification_attempt_id": str(attempt.id)},
        )
    except paymongo.TransferRejected as exc:
        logger.warning(
            "Penny-drop verification for merchant %s rejected: %s",
            merchant_id,
            exc.codes or "-",
        )
        reason = f"PayMongo rejected the verification transfer: {exc}"[:1000]
        attempt.status = _A.FAILED
        attempt.failure_reason = reason
        info.verification_status = _V.FAILED
        info.verification_error = reason
        db.commit()
        raise PayoutError(400, reason) from exc
    except paymongo.TransferOutcomeUnknown as exc:
        logger.error(
            "Penny-drop verification for merchant %s outcome unknown: %s",
            merchant_id,
            exc.codes or "-",
        )
        info.verification_status = _V.TRANSFER_SENT
        db.commit()
        db.refresh(attempt)
        return attempt

    attempt.paymongo_transfer_id = transfer.get("id")
    attempt.provider_reference = transfer.get("provider_reference_number")
    attempt.status = (
        _A.SETTLED if transfer.get("status") == "succeeded" else _A.SENT
    )
    info.verification_status = _V.TRANSFER_SENT
    db.commit()
    db.refresh(attempt)
    return attempt


def confirm_penny_drop(
    db: Session, merchant_id: int, amount_centavos: int
) -> MerchantPayoutInfo:
    """Confirm the exact centavos received from the latest penny-drop transfer."""
    info = (
        db.query(MerchantPayoutInfo)
        .filter(MerchantPayoutInfo.merchant_id == merchant_id)
        .with_for_update()
        .first()
    )
    if info is None:
        raise PayoutError(400, "Set up your payout method first.")
    if info.verification_status == _V.VERIFIED:
        return info

    fp = info_fingerprint(info)
    attempt = (
        db.query(PayoutVerificationAttempt)
        .filter(
            PayoutVerificationAttempt.merchant_id == merchant_id,
            PayoutVerificationAttempt.destination_fingerprint == fp,
            PayoutVerificationAttempt.status.in_(_CONFIRMABLE_ATTEMPT_STATUSES),
        )
        .order_by(PayoutVerificationAttempt.id.desc())
        .with_for_update()
        .first()
    )
    if attempt is None:
        raise PayoutError(
            404,
            "No active verification transfer found. Request a verification transfer first.",
        )

    now = datetime.now(UTC)
    if _aware(attempt.expires_at) <= now:
        attempt.status = _A.EXPIRED
        info.verification_status = _V.UNVERIFIED
        db.commit()
        raise PayoutError(
            400, "This verification transfer has expired. Request a new one."
        )

    if attempt.attempts_remaining <= 0:
        raise PayoutError(
            400, "Too many incorrect guesses. Request a new verification transfer."
        )

    if amount_centavos != attempt.amount_centavos:
        attempt.attempts_remaining -= 1
        if attempt.attempts_remaining <= 0:
            reason = "Too many incorrect verification amount attempts."
            attempt.status = _A.FAILED
            attempt.failure_reason = reason
            info.verification_status = _V.FAILED
            info.verification_error = reason
            db.commit()
            raise PayoutError(
                400, "Too many incorrect guesses. Request a new verification transfer."
            )
        db.commit()
        raise PayoutError(
            400,
            f"Amount does not match. {attempt.attempts_remaining} attempt(s) remaining.",
        )

    attempt.status = _A.CONFIRMED
    attempt.confirmed_at = now
    info.verification_status = _V.VERIFIED
    info.verification_method = "penny_drop"
    info.verified_at = now
    info.verification_error = None
    move_failed_batches(db, merchant_id, resolve_destination(info))
    db.commit()
    db.refresh(info)
    return info


def handle_verification_transfer_event(
    db: Session, event_type: str, resource: dict[str, Any]
) -> bool:
    """Apply a ``transfer.outward.*`` webhook to a penny-drop attempt if it matches one.

    Returns True when the event belonged to a verification attempt.
    """
    attrs = resource.get("attributes") or resource
    transfer_id = attrs.get("transfer_id") or resource.get("id")
    reference = attrs.get("reference_number")
    metadata = attrs.get("metadata") or {}
    attempt_id = metadata.get("verification_attempt_id")

    attempt = None
    if attempt_id:
        try:
            attempt = db.get(PayoutVerificationAttempt, int(attempt_id))
        except (TypeError, ValueError):
            attempt = None
    if attempt is None and transfer_id:
        attempt = (
            db.query(PayoutVerificationAttempt)
            .filter(PayoutVerificationAttempt.paymongo_transfer_id == transfer_id)
            .first()
        )
    if attempt is None and reference:
        attempt = (
            db.query(PayoutVerificationAttempt)
            .filter(PayoutVerificationAttempt.paymongo_reference == reference)
            .first()
        )
    if attempt is None:
        return False

    if transfer_id and not attempt.paymongo_transfer_id:
        attempt.paymongo_transfer_id = transfer_id
    provider_ref = attrs.get("provider_reference_number")
    if provider_ref:
        attempt.provider_reference = provider_ref

    status = attrs.get("status") or (
        "succeeded" if event_type.endswith("successful") else "failed"
    )
    if status == "succeeded":
        if attempt.status in (_A.SENDING, _A.SENT):
            attempt.status = _A.SETTLED
    elif status == "failed":
        if attempt.status != _A.CONFIRMED:
            err_code = attrs.get("provider_error_code")
            err_msg = attrs.get("provider_error_message") or attrs.get("provider_error")
            reason = (
                " - ".join(p for p in (err_code, err_msg) if p)
                or "Verification transfer failed at the receiving bank"
            )[:1000]
            attempt.status = _A.FAILED
            attempt.failure_reason = reason
            info = (
                db.query(MerchantPayoutInfo)
                .filter(MerchantPayoutInfo.merchant_id == attempt.merchant_id)
                .first()
            )
            if (
                info is not None
                and info.verification_status != _V.VERIFIED
                and info_fingerprint(info) == attempt.destination_fingerprint
            ):
                info.verification_status = _V.FAILED
                info.verification_error = reason
    db.commit()
    logger.info(
        "Payout verification attempt %s -> %s via %s",
        attempt.id,
        attempt.status,
        event_type,
    )
    return True

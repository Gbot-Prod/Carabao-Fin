"""The SMS code that confirms a new payout destination (CF-0004).

A merchant asks for a code for one exact destination; the code is sent to the
account's verified mobile number and only saves that destination (the key
holds a fingerprint of it). Codes are kept by app/services/otp.py (CF-0016).
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import UTC, datetime

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.integrations.sms.semaphore import SemaphoreError, send_otp, send_sms
from app.models.user import User
from app.services import otp, rate_limit
from app.services.email import send_payout_change_email
from app.services.phone_verification import changed_recently, normalize_ph_mobile

logger = logging.getLogger(__name__)

_FIELDS = (
    "payout_type",
    "bank_code",
    "account_number",
    "account_name",
    "ewallet_number",
)

# Literal {otp} is Semaphore's placeholder.
_MESSAGE = (
    "Your Carabao code to set your payout account to {label} is {{otp}}. "
    "Valid for 10 minutes. If you did not ask for this, do not share it and "
    "contact support."
)


def fingerprint(values: dict) -> str:
    canonical = json.dumps({k: values.get(k) for k in _FIELDS}, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()[:32]


def describe(values: dict) -> str:
    """A short, masked name for a destination, e.g. "GCash ending 4567"."""
    kind = values.get("payout_type")
    if kind == "bank":
        bank = values.get("bank_name") or values.get("bank_code") or "bank"
        return f"{bank} account ending {(values.get('account_number') or '')[-4:]}"
    label = {"gcash": "GCash", "maya": "Maya"}.get(kind, kind or "account")
    return f"{label} ending {(values.get('ewallet_number') or '')[-4:]}"


def _key(user: User, values: dict) -> str:
    return f"payout:{user.id}:{fingerprint(values)}"


def account_number(user: User) -> str:
    """The verified mobile number codes go to, or 400."""
    number = (
        normalize_ph_mobile(user.phone_number or "") if user.phone_verified else None
    )
    if not number:
        raise HTTPException(
            status_code=400,
            detail="Add and verify a mobile number on your profile before you change "
            "where payouts go.",
        )
    return number


def send_code(db: Session, request: Request, user: User, values: dict) -> str:
    """Text a code for exactly ``values``; returns the last 4 digits it went to."""
    number = account_number(user)
    rate_limit.enforce(db, request, "otp_send", number)
    key = _key(user, values)
    # Checks the secret and the cooldown before any SMS credit is spent.
    otp.reserve_send(db, key)
    try:
        # Semaphore may send its own code; keep the one the merchant gets.
        code = send_otp(
            number=number,
            message=_MESSAGE.format(label=describe(values)),
            code=otp.generate_code(),
        )
    except SemaphoreError as exc:
        otp.release_send(db, key)
        raise HTTPException(
            status_code=502, detail="The code could not be sent. Try again."
        ) from exc
    except Exception:
        otp.release_send(db, key)
        raise
    otp.store_code(db, key, code)
    return number[-4:]


def check_code(
    db: Session, request: Request, user: User, values: dict, code: str
) -> None:
    """Consume the code for exactly ``values``, or raise 400 (app/services/otp.py)."""
    rate_limit.enforce(db, request, "otp_verify", str(user.id))
    otp.check_code(db, _key(user, values), code)


def alert_numbers(user: User, merchant, now: datetime | None = None) -> list[str]:
    """Where the SMS alert goes: the account number and the shop's contact
    number, plus each one's number before a change in the last 3 days (a
    hijacked session can verify a new number; the old one is the owner's)."""
    now = now or datetime.now(UTC)
    candidates = [user.phone_number, getattr(merchant, "contact_number", None)]
    identity = user.identity
    if identity is not None and changed_recently(
        identity.phone_number_changed_at, now
    ):
        candidates.append(identity.previous_phone_number)
    if merchant is not None and changed_recently(
        merchant.contact_number_changed_at, now
    ):
        candidates.append(merchant.previous_contact_number)
    return sorted({normalize_ph_mobile(n or "") for n in candidates} - {None})


def alert_contacts(user: User, merchant, *, old: str, new: str) -> None:
    """Tell the merchant that the payout account changed.

    SMS to each number from alert_numbers(), once each, and an email to the
    account's verified email when it has one. A security alert, so it
    ignores the notification preferences. Never raises.
    """
    message = (
        f"Carabao: your payout account was changed from {old} to {new}. "
        "If this was not you, contact Carabao support now."
    )
    for number in alert_numbers(user, merchant):
        try:
            send_sms(number=number, message=message)
        except SemaphoreError as exc:
            logger.warning(
                "[sms] Payout change alert to ...%s failed: %s", number[-4:], exc
            )
    email = user.verified_email
    if email:
        try:
            send_payout_change_email(email, old=old, new=new)
        except Exception as exc:  # noqa: BLE001 - an alert must not fail the save
            logger.warning("[email] Payout change alert failed: %s", exc)

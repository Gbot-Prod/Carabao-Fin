"""The SMS code that confirms deleting your own account.

An account with a password must type it before a code is sent; the code then
goes to the account's verified mobile number. So a session alone (a stolen
cookie, a shared device) cannot delete the account. Codes are kept by
app/services/otp.py (CF-0016), the same as payout-change codes.

The same two steps confirm closing a merchant profile (``purpose="merchant"``),
with its own code, so a code sent for one cannot delete the other.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.integrations.sms.semaphore import SemaphoreError, send_otp
from app.models.user import User
from app.services import better_auth_store, otp, rate_limit
from app.services.phone_verification import normalize_ph_mobile

Purpose = Literal["account", "merchant"]

# What the code deletes, as the SMS and the errors name it.
_WHAT: dict[str, str] = {"account": "account", "merchant": "merchant profile"}

# Literal {otp} is Semaphore's placeholder.
_MESSAGE = (
    "Your Carabao code to DELETE your {what} is {{otp}}. Valid for 10 minutes. "
    "If you did not ask for this, do not share it and change your password."
)


def _key(user: User, purpose: Purpose) -> str:
    return f"{purpose}-delete:{user.id}"


def account_number(user: User, purpose: Purpose = "account") -> str:
    """The verified mobile number the code goes to, or 400."""
    number = (
        normalize_ph_mobile(user.phone_number or "") if user.phone_verified else None
    )
    if not number:
        raise HTTPException(
            status_code=400,
            detail="Add and verify a mobile number on your profile before you "
            f"delete your {_WHAT[purpose]}.",
        )
    return number


def check_password(
    db: Session, request: Request, user: User, password: str | None
) -> None:
    """Raise 400 unless ``password`` is the account's password. An account with
    no password (Google/Facebook sign-in only) skips this step."""
    stored = better_auth_store.stored_password(db, user.external_auth_id)
    if stored is None:
        return
    rate_limit.enforce(db, request, "password_check", str(user.id))
    if not password or not better_auth_store.password_matches(stored, password):
        raise HTTPException(status_code=400, detail="Your password is not correct.")


def send_code(
    db: Session, request: Request, user: User, purpose: Purpose = "account"
) -> str:
    """Text a deletion code; returns the last 4 digits it went to."""
    number = account_number(user, purpose)
    rate_limit.enforce(db, request, "otp_send", number)
    key = _key(user, purpose)
    # Checks the secret and the cooldown before any SMS credit is spent.
    otp.reserve_send(db, key)
    try:
        # SMS codes count against one per-user limit across every purpose.
        rate_limit.enforce_identifier(db, "otp_send_user", str(user.id))
        # Semaphore may send its own code; keep the one the user gets.
        code = send_otp(
            number=number,
            message=_MESSAGE.format(what=_WHAT[purpose]),
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
    db: Session, request: Request, user: User, code: str, purpose: Purpose = "account"
) -> None:
    """Consume the deletion code, or raise 400 (app/services/otp.py)."""
    rate_limit.enforce(db, request, "otp_verify", str(user.id))
    otp.check_code(db, _key(user, purpose), code)

"""One-time codes the backend sends and checks itself (CF-0016).

Used for the merchant contact-number codes. (BetterAuth stores and checks its
own account phone codes.) Rows live in ``otp_codes``, so every API worker sees
the same code and attempt count.

Only an HMAC-SHA256 of the code is stored, keyed with AUTH_SYNC_SHARED_SECRET
and bound to the row key, so a database leak does not give working codes and
a hash cannot be reused for another user or number.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import os
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.otp import OtpCode
from app.services.rate_limit import lock_keys

OTP_TTL_SECONDS = 600  # 10 minutes
# Site-wide: one code per minute to the same target. BetterAuth's account codes
# use the same wait (lib/auth.ts otpResendCooldown), and the web pages count it
# down (hooks/useResendCooldown.ts OTP_RESEND_SECONDS).
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5

INVALID_CODE = "Invalid or expired verification code"
TOO_MANY_ATTEMPTS = "Too many invalid attempts. Please request a new code."


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime) -> datetime:
    # SQLite (tests) returns naive datetimes; Postgres returns aware ones.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def generate_code() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(6))


def hash_code(key: str, code: str) -> str:
    """HMAC of ``code`` bound to ``key``. Raises RuntimeError if the secret is unset."""
    secret = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not secret:
        raise RuntimeError("AUTH_SYNC_SHARED_SECRET is not configured")
    message = f"otp:{key}:{code.strip()}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def reserve_send(db: Session, key: str) -> None:
    """Claim the right to send one code to ``key`` now, or raise. Commits.

    Call before the SMS goes out. Raises RuntimeError if the secret is unset (so
    no SMS credit is spent on a code that cannot be stored) and 429 if a code
    was sent too recently. The check and the claim happen under one lock, so two
    requests at the same time cannot both send. The claim is a row with an empty
    hash, which no code matches; store_code replaces it. Any older code for
    ``key`` stops working. If the send fails, call release_send.
    """
    hash_code(key, "0")  # fail early if the secret is missing
    now = _now()
    try:
        lock_keys(db, f"otp:{key}")
        record = (
            db.query(OtpCode).filter(OtpCode.key == key).with_for_update().first()
        )
        if record is not None:
            ready_at = _aware(record.sent_at) + timedelta(
                seconds=OTP_RESEND_COOLDOWN_SECONDS
            )
            if now < ready_at:
                # Retry-After lets the client resume its countdown (hooks/useResendCooldown.ts).
                wait = max(1, math.ceil((ready_at - now).total_seconds()))
                raise HTTPException(
                    status_code=429,
                    detail=f"Please wait {wait} seconds before requesting another code.",
                    headers={"Retry-After": str(wait)},
                )
            db.delete(record)
            db.flush()
        db.add(
            OtpCode(
                key=key,
                code_hash="",
                attempts=0,
                sent_at=now,
                # Kept past the cooldown, so purge_expired cannot drop the claim.
                expires_at=now + timedelta(seconds=OTP_RESEND_COOLDOWN_SECONDS),
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


def release_send(db: Session, key: str) -> None:
    """Remove the claim from reserve_send after a failed send. Commits."""
    try:
        lock_keys(db, f"otp:{key}")
        db.query(OtpCode).filter(
            OtpCode.key == key, OtpCode.code_hash == ""
        ).delete(synchronize_session=False)
        db.commit()
    except Exception:
        db.rollback()
        raise


def store_code(db: Session, key: str, code: str) -> None:
    """Save ``code`` as the only valid code for ``key`` and commit."""
    code_hash = hash_code(key, code)
    now = _now()
    try:
        lock_keys(db, f"otp:{key}")
        db.query(OtpCode).filter(OtpCode.key == key).delete(synchronize_session=False)
        db.add(
            OtpCode(
                key=key,
                code_hash=code_hash,
                attempts=0,
                sent_at=now,
                expires_at=now + timedelta(seconds=OTP_TTL_SECONDS),
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


def check_code(db: Session, key: str, code: str) -> None:
    """Accept and remove the code for ``key``, or raise 400.

    A wrong code adds one attempt. After OTP_MAX_ATTEMPTS the code is removed,
    so even the right one is refused. Commits in every case.
    """
    candidate = hash_code(key, code)
    try:
        lock_keys(db, f"otp:{key}")
        record = (
            db.query(OtpCode).filter(OtpCode.key == key).with_for_update().first()
        )
        error: str | None = None
        if record is None:
            error = INVALID_CODE
        elif _now() > _aware(record.expires_at):
            db.delete(record)
            error = INVALID_CODE
        elif record.attempts >= OTP_MAX_ATTEMPTS:
            db.delete(record)
            error = TOO_MANY_ATTEMPTS
        elif not record.code_hash:
            # A send is still in progress (reserve_send); no code exists yet.
            error = INVALID_CODE
        elif not hmac.compare_digest(record.code_hash, candidate):
            record.attempts += 1
            error = INVALID_CODE
        else:
            db.delete(record)
        db.commit()
    except Exception:
        db.rollback()
        raise
    if error is not None:
        raise HTTPException(status_code=400, detail=error)


def purge_expired(db: Session) -> int:
    """Delete expired codes. The caller commits."""
    return (
        db.query(OtpCode)
        .filter(OtpCode.expires_at < _now())
        .delete(synchronize_session=False)
    )

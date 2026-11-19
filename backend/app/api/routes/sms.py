from __future__ import annotations

import logging
import time
from threading import Lock
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db, require_internal_secret
from app.core.errors import upstream_error
from app.integrations.sms.semaphore import SemaphoreError
from app.integrations.sms.semaphore import send_otp as semaphore_send_otp
from app.models.user import User
from app.services import otp, rate_limit
from app.services.phone_verification import (
    CONTACT_VERIFICATION_TTL,
    normalize_ph_mobile,
    sign_token,
)

router = APIRouter(tags=["sms"])
logger = logging.getLogger(__name__)

_otp_lock = Lock()  # guards _sent_today only
_OTP_USER_HOURLY_LIMIT = rate_limit.IDENTIFIER_LIMITS["otp_send_user"].max_hits

# Literal {otp} is Semaphore's placeholder — do not .format() this.
_OTP_MESSAGE = "Your Carabao verification code is {otp}. Valid for 10 minutes. Do not share this with anyone."


def _normalize_phone_number(value: str) -> str:
    normalized = normalize_ph_mobile(value)
    if normalized is None:
        raise HTTPException(
            status_code=400,
            detail="Use a valid Philippine mobile number, e.g. +63 912 345 6789",
        )
    return normalized


def _semaphore_send_otp(number: str, otp: str) -> str:
    return _semaphore_send_otp_message(number, otp, _OTP_MESSAGE)


def _semaphore_send_otp_message(number: str, otp: str, message: str) -> str:
    """Send via Semaphore's OTP route; returns the code actually delivered."""
    try:
        return semaphore_send_otp(number=number, message=message, code=otp)
    except SemaphoreError as exc:
        if "not configured" in str(exc):
            raise upstream_error(
                500,
                "SMS service is not available",
                log="[sms] Semaphore is not configured",
                exc=exc,
            ) from exc
        raise upstream_error(
            502,
            "Verification message could not be sent",
            log="[sms] Semaphore send failed",
            exc=exc,
        ) from exc


# ── Merchant onboarding: the shop's contact number (logged-in users) ────────


class OTPSendRequest(BaseModel):
    number: str = Field(max_length=20)

    model_config = ConfigDict(extra="forbid")  # CF-0063


class OTPVerifyRequest(BaseModel):
    number: str = Field(max_length=20)
    otp: str = Field(max_length=12)

    model_config = ConfigDict(extra="forbid")  # CF-0063


def _merchant_otp_key(user_id: int, number: str) -> str:
    return f"merchant:{user_id}:{number}"


@router.post("/sms/otp/send")
def send_otp_code(
    body: OTPSendRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    number = _normalize_phone_number(body.number)
    rate_limit.enforce(db, request, "otp_send", number)
    key = _merchant_otp_key(current_user.id, number)
    try:
        # Checks the secret and the cooldown before any SMS credit is spent.
        otp.reserve_send(db, key)
    except RuntimeError as exc:
        raise upstream_error(
            500,
            "Phone verification is not available",
            log="OTP hashing secret is missing",
            exc=exc,
        ) from exc
    try:
        # Counted before the SMS, so concurrent requests can't slip past the cap.
        rate_limit.enforce_identifier(db, "otp_send_user", str(current_user.id))
        delivered = _semaphore_send_otp(number, otp.generate_code())
    except Exception:
        otp.release_send(db, key)
        raise
    otp.store_code(db, key, delivered)
    return {"ok": True}


@router.post("/sms/otp/verify")
def verify_otp_code(
    body: OTPVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    number = _normalize_phone_number(body.number)
    rate_limit.enforce(db, request, "otp_verify", number)
    try:
        otp.check_code(db, _merchant_otp_key(current_user.id, number), body.otp)
        token = sign_token(
            {"purpose": "merchant_phone", "user_id": current_user.id, "number": number},
            CONTACT_VERIFICATION_TTL,
        )
    except RuntimeError as exc:
        raise upstream_error(
            500,
            "Phone verification is not available",
            log="Phone verification secret is missing",
            exc=exc,
        ) from exc
    return {"ok": True, "verification_token": token}


# ── Account phone OTPs (BetterAuth phoneNumber plugin) ──────────────────
#
# BetterAuth generates, stores and checks these codes; lib/auth.ts sendOTP asks
# the backend to deliver them so the Semaphore key and the per-number limit
# live in one place. Per-IP limits are BetterAuth's (lib/auth.ts rateLimit).

_ACCOUNT_OTP_MESSAGES = {
    "verify": "Your Carabao verification code is {otp}. Valid for 10 minutes. "
    "Do not share this with anyone.",
    "password_reset": "Your Carabao password reset code is {otp}. Valid for "
    "10 minutes. If you didn't ask for it, ignore this message.",
}

_sent_today: dict[str, int] = {"day": 0, "count": 0}


class AccountOTPRequest(BaseModel):
    phone_number: str = Field(max_length=20)
    code: str = Field(max_length=12)
    purpose: Literal["verify", "password_reset"] = "verify"

    model_config = ConfigDict(extra="forbid")  # CF-0063


def _count_send() -> int:
    """Account OTPs sent today (UTC, this process), logged to spot SMS pumping."""
    today = int(time.time() // 86400)
    with _otp_lock:
        if _sent_today["day"] != today:
            _sent_today.update(day=today, count=0)
        _sent_today["count"] += 1
        return _sent_today["count"]


@router.post(
    "/internal/sms/account-otp", dependencies=[Depends(require_internal_secret)]
)
def send_account_otp(body: AccountOTPRequest, db: Session = Depends(get_db)):
    number = _normalize_phone_number(body.phone_number)
    if not body.code.isdigit():
        raise HTTPException(status_code=400, detail="The code must be numeric")
    rate_limit.enforce_identifier(db, "account_otp", number)
    delivered = _semaphore_send_otp_message(
        number, body.code, _ACCOUNT_OTP_MESSAGES[body.purpose]
    )
    logger.info(
        "[sms] Account OTP sent purpose=%s to=...%s today=%d",
        body.purpose,
        number[-4:],
        _count_send(),
    )
    # Semaphore may substitute its own code; BetterAuth stores whatever this says.
    return {"ok": True, "code": delivered}

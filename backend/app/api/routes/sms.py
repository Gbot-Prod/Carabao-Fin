from __future__ import annotations

import logging
import secrets
import time
from threading import Lock
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.dependencies import get_current_user, require_internal_secret
from app.integrations.sms.semaphore import SemaphoreError
from app.integrations.sms.semaphore import send_otp as semaphore_send_otp
from app.models.user import User
from app.services import rate_limit
from app.services.phone_verification import normalize_ph_mobile, sign_token

router = APIRouter(tags=["sms"])
logger = logging.getLogger(__name__)

_otp_store: dict[str, dict] = {}
_user_send_log: dict[int, list[float]] = {}
_otp_lock = Lock()
_OTP_TTL = 600  # 10 minutes
_OTP_RESEND_COOLDOWN = 60
_OTP_MAX_ATTEMPTS = 5
_OTP_USER_HOURLY_LIMIT = 5
_PHONE_VERIFICATION_TTL = 1800  # 30 minutes to finish onboarding after verifying

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


def _generate_otp() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(6))


def _semaphore_send_otp(number: str, otp: str) -> str:
    return _semaphore_send_otp_message(number, otp, _OTP_MESSAGE)


def _semaphore_send_otp_message(number: str, otp: str, message: str) -> str:
    """Send via Semaphore's OTP route; returns the code actually delivered."""
    try:
        return semaphore_send_otp(number=number, message=message, code=otp)
    except SemaphoreError as exc:
        logger.exception("[sms] Semaphore send failed")
        if "not configured" in str(exc):
            raise HTTPException(
                status_code=500, detail="SMS service is not configured"
            ) from exc
        raise HTTPException(
            status_code=502, detail="Verification message could not be sent"
        ) from exc


def _check_resend_cooldown(key: str) -> None:
    """Raise 429 if a code was sent to this key too recently. Caller holds the lock."""
    previous = _otp_store.get(key)
    if (
        previous
        and time.monotonic() < float(previous["sent_at"]) + _OTP_RESEND_COOLDOWN
    ):
        raise HTTPException(
            status_code=429, detail="Please wait before requesting another code"
        )


def _check_otp(key: str, otp: str) -> None:
    """Validate and consume a stored code, counting failed attempts."""
    with _otp_lock:
        record = _otp_store.get(key)
        if record and time.monotonic() > float(record["expires"]):
            del _otp_store[key]
            record = None
        if not record:
            raise HTTPException(
                status_code=400, detail="Invalid or expired verification code"
            )
        if int(record["attempts"]) >= _OTP_MAX_ATTEMPTS:
            _otp_store.pop(key, None)
            raise HTTPException(
                status_code=400,
                detail="Too many invalid attempts. Please request a new code.",
            )
        if not secrets.compare_digest(str(record["otp"]), otp.strip()):
            record["attempts"] = int(record["attempts"]) + 1
            raise HTTPException(
                status_code=400, detail="Invalid or expired verification code"
            )
        _otp_store.pop(key, None)


def _store_otp(key: str, otp: str) -> None:
    now = time.monotonic()
    with _otp_lock:
        _otp_store[key] = {
            "otp": otp,
            "expires": now + _OTP_TTL,
            "sent_at": now,
            "attempts": 0,
        }


# ── Merchant onboarding: the shop's contact number (logged-in users) ────────


class OTPSendRequest(BaseModel):
    number: str


class OTPVerifyRequest(BaseModel):
    number: str
    otp: str


def _merchant_otp_key(user_id: int, number: str) -> str:
    return f"merchant:{user_id}:{number}"


@router.post("/sms/otp/send")
def send_otp_code(
    body: OTPSendRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    number = _normalize_phone_number(body.number)
    rate_limit.enforce(request, "otp_send", number)
    key = _merchant_otp_key(current_user.id, number)
    now = time.monotonic()

    with _otp_lock:
        _check_resend_cooldown(key)
        recent = [t for t in _user_send_log.get(current_user.id, []) if now - t < 3600]
        if len(recent) >= _OTP_USER_HOURLY_LIMIT:
            raise HTTPException(
                status_code=429,
                detail="Too many verification codes requested. Please try again later.",
            )
        # Count the send up front so concurrent requests can't slip past the cap.
        recent.append(now)
        _user_send_log[current_user.id] = recent

    otp = _semaphore_send_otp(number, _generate_otp())
    _store_otp(key, otp)
    return {"ok": True}


@router.post("/sms/otp/verify")
def verify_otp_code(
    body: OTPVerifyRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    number = _normalize_phone_number(body.number)
    rate_limit.enforce(request, "otp_verify", number)
    _check_otp(_merchant_otp_key(current_user.id, number), body.otp)
    try:
        token = sign_token(
            {"purpose": "merchant_phone", "user_id": current_user.id, "number": number},
            _PHONE_VERIFICATION_TTL,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True, "verification_token": token}


# ── Account phone OTPs (BetterAuth phoneNumber plugin) ──────────────────
#
# BetterAuth generates, stores and checks these codes; lib/auth.ts sendOTP asks
# the backend to deliver them so the Semaphore key and the per-number limit
# live in one place. Per-IP limits are BetterAuth's (lib/auth.ts rateLimit).

_ACCOUNT_OTP_MESSAGES = {
    "verify": "Your Carabao verification code is {otp}. Valid for 5 minutes. "
    "Do not share this with anyone.",
    "password_reset": "Your Carabao password reset code is {otp}. Valid for "
    "5 minutes. If you didn't ask for it, ignore this message.",
}

_sent_today: dict[str, int] = {"day": 0, "count": 0}


class AccountOTPRequest(BaseModel):
    phone_number: str
    code: str
    purpose: Literal["verify", "password_reset"] = "verify"


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
def send_account_otp(body: AccountOTPRequest):
    number = _normalize_phone_number(body.phone_number)
    if not body.code.isdigit():
        raise HTTPException(status_code=400, detail="The code must be numeric")
    rate_limit.enforce_identifier("account_otp", number)
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

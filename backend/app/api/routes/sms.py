from __future__ import annotations

import logging
import secrets
import time
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.dependencies import get_current_user
from app.integrations.sms.semaphore import SemaphoreError
from app.integrations.sms.semaphore import send_sms as semaphore_send_sms
from app.models.user import User, normalize_email
from app.services.email import send_signup_otp_email
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


def _semaphore_send(number: str, message: str) -> None:
    try:
        semaphore_send_sms(number=number, message=message)
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
    if previous and time.monotonic() < float(previous["sent_at"]) + _OTP_RESEND_COOLDOWN:
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


# ── Merchant onboarding phone verification (logged-in users) ────────────


class OTPSendRequest(BaseModel):
    number: str


class OTPVerifyRequest(BaseModel):
    number: str
    otp: str


def _merchant_otp_key(user_id: int, number: str) -> str:
    return f"merchant:{user_id}:{number}"


@router.post("/sms/otp/send")
async def send_otp_code(
    body: OTPSendRequest, current_user: User = Depends(get_current_user)
):
    number = _normalize_phone_number(body.number)
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

    otp = _generate_otp()
    _semaphore_send(number, _OTP_MESSAGE.format(otp=otp))
    _store_otp(key, otp)
    return {"ok": True}


@router.post("/sms/otp/verify")
async def verify_otp_code(
    body: OTPVerifyRequest, current_user: User = Depends(get_current_user)
):
    number = _normalize_phone_number(body.number)
    _check_otp(_merchant_otp_key(current_user.id, number), body.otp)
    try:
        token = sign_token(
            {"purpose": "merchant_phone", "user_id": current_user.id, "number": number},
            _PHONE_VERIFICATION_TTL,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True, "verification_token": token}


# ── Signup verification (public, pre-account) ──────────────────────────


class SignupVerificationRequest(BaseModel):
    channel: str
    identifier: str


class SignupVerificationVerifyRequest(SignupVerificationRequest):
    otp: str


@router.post("/auth/signup-verification/request")
async def request_signup_verification(body: SignupVerificationRequest):
    channel = body.channel.strip().lower()
    identifier = body.identifier.strip()
    if channel not in {"email", "phone"} or not identifier:
        raise HTTPException(
            status_code=400, detail="A valid signup identifier is required"
        )
    if channel == "email" and ("@" not in identifier or len(identifier) > 254):
        raise HTTPException(status_code=400, detail="A valid email address is required")
    if channel == "email":
        identifier = normalize_email(identifier)
    if channel == "phone":
        identifier = _normalize_phone_number(identifier)

    otp = _generate_otp()
    key = f"signup:{channel}:{identifier}"
    with _otp_lock:
        _check_resend_cooldown(key)
    try:
        if channel == "email":
            send_signup_otp_email(to=identifier, otp=otp)
        else:
            _semaphore_send(identifier, _OTP_MESSAGE.format(otp=otp))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Signup verification delivery failed for channel=%s", channel)
        raise HTTPException(
            status_code=502, detail="Verification message could not be sent"
        ) from exc

    _store_otp(key, otp)
    return {"ok": True}


@router.post("/auth/signup-verification/verify")
async def verify_signup_verification(body: SignupVerificationVerifyRequest):
    channel = body.channel.strip().lower()
    identifier = body.identifier.strip()
    if channel == "email":
        identifier = normalize_email(identifier)
    if channel == "phone":
        identifier = _normalize_phone_number(identifier)
    _check_otp(f"signup:{channel}:{identifier}", body.otp)
    try:
        token = sign_token({"channel": channel, "identifier": identifier}, 1800)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True, "verification_token": token}

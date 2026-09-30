from __future__ import annotations

import secrets
import time
from threading import Lock

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.integrations.sms.semaphore import SemaphoreError, send_sms as semaphore_send_sms
from app.services.email import send_signup_otp_email

router = APIRouter(tags=["sms"])

_otp_store: dict[str, dict] = {}
_otp_lock = Lock()
_OTP_TTL = 600  # 10 minutes
_OTP_RESEND_COOLDOWN = 60
_OTP_MAX_ATTEMPTS = 5


# ── Raw send endpoints ────────────────────────────────────────────────────────

class SemaphoreSendRequest(BaseModel):
    number: str
    message: str
    sendername: str | None = None


@router.post("/sms/semaphore/send")
async def send_semaphore_sms(body: SemaphoreSendRequest):
    try:
        return semaphore_send_sms(number=body.number, message=body.message, sendername=body.sendername)
    except SemaphoreError as exc:
        msg = str(exc)
        if "not configured" in msg:
            raise HTTPException(status_code=500, detail=msg) from exc
        if "required" in msg or "must not start" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=502, detail=msg) from exc


# ── Templated message endpoints ───────────────────────────────────────────────

class OTPSendRequest(BaseModel):
    number: str


class OTPVerifyRequest(BaseModel):
    number: str
    otp: str


class SignupVerificationRequest(BaseModel):
    channel: str
    identifier: str


class SignupVerificationVerifyRequest(SignupVerificationRequest):
    otp: str


def _semaphore_send(number: str, message: str) -> None:
    try:
        semaphore_send_sms(number=number, message=message)
    except SemaphoreError as exc:
        msg = str(exc)
        if "not configured" in msg:
            raise HTTPException(status_code=500, detail=msg) from exc
        if "required" in msg or "must not start" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=502, detail=msg) from exc


@router.post("/sms/otp/send")
async def send_otp_code(body: OTPSendRequest):
    number = body.number.strip()
    if not number:
        raise HTTPException(status_code=400, detail="Phone number is required")

    otp = "".join(secrets.choice("0123456789") for _ in range(6))
    _semaphore_send(
        number,
        f"Your Carabao verification code is {otp}. Valid for 10 minutes. Do not share this with anyone.",
    )

    with _otp_lock:
        _otp_store[number] = {"otp": otp, "expires": time.monotonic() + _OTP_TTL}

    return {"ok": True}


@router.post("/sms/otp/verify")
async def verify_otp_code(body: OTPVerifyRequest):
    number = body.number.strip()
    otp = body.otp.strip()

    with _otp_lock:
        record = _otp_store.get(number)
        if record and time.monotonic() > float(record["expires"]):
            del _otp_store[number]
            record = None

    if not record:
        raise HTTPException(
            status_code=400,
            detail="Code expired or not found. Please request a new code.",
        )

    if not secrets.compare_digest(str(record["otp"]), otp):
        raise HTTPException(status_code=400, detail="Incorrect verification code.")

    with _otp_lock:
        _otp_store.pop(number, None)

    return {"ok": True}


@router.post("/auth/signup-verification/request")
async def request_signup_verification(body: SignupVerificationRequest):
    channel = body.channel.strip().lower()
    identifier = body.identifier.strip()
    if channel not in {"email", "phone"} or not identifier:
        raise HTTPException(status_code=400, detail="A valid signup identifier is required")
    if channel == "email" and ("@" not in identifier or len(identifier) > 254):
        raise HTTPException(status_code=400, detail="A valid email address is required")
    if channel == "phone" and (len(identifier) > 20 or not identifier.replace("+", "").replace(" ", "").isdigit()):
        raise HTTPException(status_code=400, detail="A valid phone number is required")

    otp = "".join(secrets.choice("0123456789") for _ in range(6))
    message = f"Your Carabao verification code is {otp}. Valid for 10 minutes. Do not share this with anyone."
    key = f"signup:{channel}:{identifier}"
    with _otp_lock:
        previous = _otp_store.get(key)
        if previous and time.monotonic() < float(previous["sent_at"]) + _OTP_RESEND_COOLDOWN:
            raise HTTPException(status_code=429, detail="Please wait before requesting another code")
    try:
        if channel == "email":
            send_signup_otp_email(to=identifier, otp=otp)
        else:
            _semaphore_send(identifier, message)
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=502, detail="Verification message could not be sent") from exc

    with _otp_lock:
        _otp_store[key] = {
            "otp": otp,
            "expires": time.monotonic() + _OTP_TTL,
            "sent_at": time.monotonic(),
            "attempts": 0,
        }
    return {"ok": True}


@router.post("/auth/signup-verification/verify")
async def verify_signup_verification(body: SignupVerificationVerifyRequest):
    channel = body.channel.strip().lower()
    identifier = body.identifier.strip()
    key = f"signup:{channel}:{identifier}"
    with _otp_lock:
        record = _otp_store.get(key)
        if record and time.monotonic() > float(record["expires"]):
            del _otp_store[key]
            record = None
    if not record:
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    if int(record["attempts"]) >= _OTP_MAX_ATTEMPTS:
        with _otp_lock:
            _otp_store.pop(key, None)
        raise HTTPException(status_code=400, detail="Too many invalid attempts. Please request a new code.")
    if not secrets.compare_digest(str(record["otp"]), body.otp.strip()):
        with _otp_lock:
            record["attempts"] = int(record["attempts"]) + 1
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")
    with _otp_lock:
        _otp_store.pop(key, None)

    import base64
    import hashlib
    import hmac
    import json
    import os

    secret = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="AUTH_SYNC_SHARED_SECRET is not configured")
    payload = base64.urlsafe_b64encode(
        json.dumps({"channel": channel, "identifier": identifier, "exp": int(time.time()) + 1800}, separators=(",", ":")).encode()
    ).decode().rstrip("=")
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return {"ok": True, "verification_token": f"{payload}.{signature}"}


class DeliveryNotificationRequest(BaseModel):
    number: str
    buyer_name: str
    produce_name: str
    estimated_arrival: str  # free-form, e.g. "today between 2–4 PM"


@router.post("/sms/delivery-notification")
async def send_delivery_notification(body: DeliveryNotificationRequest):
    message = (
        f"Hi {body.buyer_name}! Your order of {body.produce_name} from Carabao is on its way. "
        f"Estimated arrival: {body.estimated_arrival}. "
        "Track your delivery in the Carabao app."
    )

    try:
        return semaphore_send_sms(number=body.number, message=message)
    except SemaphoreError as exc:
        msg = str(exc)
        if "not configured" in msg:
            raise HTTPException(status_code=500, detail=msg) from exc
        if "required" in msg or "must not start" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=502, detail=msg) from exc

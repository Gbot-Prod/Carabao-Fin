from __future__ import annotations

import secrets
import time
from threading import Lock

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.integrations.sms.semaphore import SemaphoreError, send_sms as semaphore_send_sms
from app.integrations.sms.unisms import UniSMSError, send_sms as unisms_send_sms

router = APIRouter(tags=["sms"])

_otp_store: dict[str, dict] = {}
_otp_lock = Lock()
_OTP_TTL = 600  # 10 minutes


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


class UniSMSSendRequest(BaseModel):
    recipient: str
    content: str


@router.post("/sms/unisms/send")
async def send_unisms_sms(body: UniSMSSendRequest):
    try:
        return unisms_send_sms(recipient=body.recipient, content=body.content)
    except UniSMSError as exc:
        msg = str(exc)
        if "not configured" in msg:
            raise HTTPException(status_code=500, detail=msg) from exc
        if "required" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=502, detail=msg) from exc


# ── Templated message endpoints ───────────────────────────────────────────────

class OTPRequest(BaseModel):
    number: str
    otp_length: int = 6


class OTPResponse(BaseModel):
    otp: str


@router.post("/sms/otp", response_model=OTPResponse)
async def send_otp(body: OTPRequest):
    if not 4 <= body.otp_length <= 8:
        raise HTTPException(status_code=400, detail="otp_length must be between 4 and 8")

    otp = "".join(secrets.choice("0123456789") for _ in range(body.otp_length))
    message = f"Your Carabao verification code is {otp}. Valid for 10 minutes. Do not share this with anyone."

    try:
        semaphore_send_sms(number=body.number, message=message)
    except SemaphoreError as exc:
        msg = str(exc)
        if "not configured" in msg:
            raise HTTPException(status_code=500, detail=msg) from exc
        if "required" in msg or "must not start" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=502, detail=msg) from exc

    return OTPResponse(otp=otp)


class OTPSendRequest(BaseModel):
    number: str


class OTPVerifyRequest(BaseModel):
    number: str
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

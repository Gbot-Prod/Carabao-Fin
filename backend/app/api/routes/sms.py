from __future__ import annotations

import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.integrations.sms.semaphore import SemaphoreError, send_sms as semaphore_send_sms
from app.integrations.sms.unisms import UniSMSError, send_sms as unisms_send_sms

router = APIRouter(tags=["sms"])


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

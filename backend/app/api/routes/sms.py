from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.integrations.sms.semaphore import SemaphoreError, send_sms as semaphore_send_sms
from app.integrations.sms.unisms import UniSMSError, send_sms as unisms_send_sms

router = APIRouter(tags=["sms"])


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
        return unisms_send_sms(
            recipient=body.recipient,
            content=body.content
        )
    except UniSMSError as exc:
        msg = str(exc)
        if "not configured" in msg:
            raise HTTPException(status_code=500, detail=msg) from exc
        if "required" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=502, detail=msg) from exc

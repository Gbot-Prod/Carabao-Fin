from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.integrations.sms.semaphore import SemaphoreError, send_sms

router = APIRouter()


class SemaphoreSendRequest(BaseModel):
    number: str
    message: str
    sendername: str | None = None


@router.post("/sms/semaphore/send")
async def send_semaphore_sms(body: SemaphoreSendRequest):
    try:
        return send_sms(number=body.number, message=body.message, sendername=body.sendername)
    except SemaphoreError as exc:
        msg = str(exc)
        if "not configured" in msg:
            raise HTTPException(status_code=500, detail=msg) from exc
        if "required" in msg or "must not start" in msg:
            raise HTTPException(status_code=400, detail=msg) from exc
        raise HTTPException(status_code=502, detail=msg) from exc


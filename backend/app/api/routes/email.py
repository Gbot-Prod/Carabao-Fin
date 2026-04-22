from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, EmailStr

from app.services.email import send_verification_email

router = APIRouter()


class VerificationEmailPayload(BaseModel):
    to: EmailStr
    verification_url: str


@router.post("/email/send-verification")
async def send_verification_email_route(
    payload: VerificationEmailPayload,
    x_internal_auth_sync_secret: Optional[str] = Header(
        default=None,
        alias="X-Internal-Auth-Sync-Secret",
    ),
) -> dict:
    expected_secret = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not expected_secret:
        raise HTTPException(status_code=500, detail="AUTH_SYNC_SHARED_SECRET is not configured")
    if x_internal_auth_sync_secret != expected_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        send_verification_email(to=payload.to, verification_url=payload.verification_url)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Email delivery failed: {exc}") from exc

    return {"ok": True}

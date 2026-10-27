from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, EmailStr

from app.services.email import send_signup_otp_email, send_verification_email

router = APIRouter(tags=["email"])


class VerificationEmailPayload(BaseModel):
    to: EmailStr
    verification_url: str


class SignupOtpEmailPayload(BaseModel):
    to: EmailStr
    otp: str


@router.post("/email/send-signup-otp")
async def send_signup_otp_email_route(
    payload: SignupOtpEmailPayload,
    x_internal_auth_sync_secret: str | None = Header(
        default=None,
        alias="X-Internal-Auth-Sync-Secret",
    ),
) -> dict:
    expected_secret = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not expected_secret:
        raise HTTPException(
            status_code=500, detail="AUTH_SYNC_SHARED_SECRET is not configured"
        )
    if x_internal_auth_sync_secret != expected_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        send_signup_otp_email(to=payload.to, otp=payload.otp)
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Email delivery failed: {exc}"
        ) from exc

    return {"ok": True}


@router.post("/email/send-verification")
async def send_verification_email_route(
    payload: VerificationEmailPayload,
    x_internal_auth_sync_secret: str | None = Header(
        default=None,
        alias="X-Internal-Auth-Sync-Secret",
    ),
) -> dict:
    expected_secret = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not expected_secret:
        raise HTTPException(
            status_code=500, detail="AUTH_SYNC_SHARED_SECRET is not configured"
        )
    if x_internal_auth_sync_secret != expected_secret:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        send_verification_email(
            to=payload.to, verification_url=payload.verification_url
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Email delivery failed: {exc}"
        ) from exc

    return {"ok": True}

"""Emails BetterAuth asks for (lib/auth.ts hooks), sent through Resend."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from app.api.dependencies import require_internal_secret
from app.services.email import send_password_reset_email, send_verification_email

router = APIRouter(tags=["email"], dependencies=[Depends(require_internal_secret)])


class VerificationEmailPayload(BaseModel):
    to: EmailStr
    verification_url: str


@router.post("/email/send-verification")
def send_verification_email_route(payload: VerificationEmailPayload) -> dict:
    """An email added on the profile page (BetterAuth changeEmail)."""
    try:
        send_verification_email(
            to=payload.to, verification_url=payload.verification_url
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Email delivery failed: {exc}"
        ) from exc
    return {"ok": True}


class PasswordResetEmailPayload(BaseModel):
    to: EmailStr
    reset_url: str


@router.post("/email/send-password-reset")
def send_password_reset_email_route(payload: PasswordResetEmailPayload) -> dict:
    """Reset by email, for accounts with a verified email (E6)."""
    try:
        send_password_reset_email(to=payload.to, reset_url=payload.reset_url)
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Email delivery failed: {exc}"
        ) from exc
    return {"ok": True}

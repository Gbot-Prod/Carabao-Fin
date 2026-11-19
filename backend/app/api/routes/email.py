"""Emails BetterAuth asks for (lib/auth.ts hooks), sent through Resend."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.api.dependencies import require_internal_secret
from app.core.errors import upstream_error
from app.services.email import send_password_reset_email, send_verification_email

router = APIRouter(tags=["email"], dependencies=[Depends(require_internal_secret)])


class VerificationEmailPayload(BaseModel):
    to: EmailStr
    # CF-0063: an http(s) link only; it goes into an href.
    verification_url: str = Field(min_length=1, max_length=2000, pattern=r"^https?://")

    model_config = ConfigDict(extra="forbid")  # CF-0063


@router.post("/email/send-verification")
def send_verification_email_route(payload: VerificationEmailPayload) -> dict:
    """An email added on the profile page (BetterAuth changeEmail)."""
    try:
        send_verification_email(
            to=payload.to, verification_url=payload.verification_url
        )
    except Exception as exc:
        raise upstream_error(
            502, "The email could not be sent", log="Verification email failed", exc=exc
        ) from exc
    return {"ok": True}


class PasswordResetEmailPayload(BaseModel):
    to: EmailStr
    reset_url: str = Field(min_length=1, max_length=2000, pattern=r"^https?://")

    model_config = ConfigDict(extra="forbid")  # CF-0063


@router.post("/email/send-password-reset")
def send_password_reset_email_route(payload: PasswordResetEmailPayload) -> dict:
    """Reset by email, for accounts with a verified email (E6)."""
    try:
        send_password_reset_email(to=payload.to, reset_url=payload.reset_url)
    except Exception as exc:
        raise upstream_error(
            502,
            "The email could not be sent",
            log="Password reset email failed",
            exc=exc,
        ) from exc
    return {"ok": True}

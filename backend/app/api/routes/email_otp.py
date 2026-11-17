"""Codes that prove a merchant applicant's contact email (onboarding section 1).

The same pattern as the contact number (/sms/otp/send, /sms/otp/verify): the
API makes, stores (hashed) and checks the code; verify returns a short-lived
signed token that the onboarding submit checks.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.errors import upstream_error
from app.models.user import User, normalize_email
from app.services import otp, rate_limit
from app.services.email import send_contact_email_code
from app.services.phone_verification import CONTACT_VERIFICATION_TTL, sign_token

router = APIRouter(tags=["email-otp"])
logger = logging.getLogger(__name__)

MERCHANT_EMAIL_PURPOSE = "merchant_email"


class EmailOTPSendRequest(BaseModel):
    email: EmailStr


class EmailOTPVerifyRequest(BaseModel):
    email: EmailStr
    otp: str = Field(min_length=1, max_length=12)


def _key(user_id: int, email: str) -> str:
    return f"merchant-email:{user_id}:{email}"


@router.post("/email/otp/send")
def send_email_otp(
    body: EmailOTPSendRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email = normalize_email(str(body.email))
    rate_limit.enforce(db, request, "email_otp_send", email)
    key = _key(current_user.id, email)
    try:
        # Checks the secret and the cooldown before any email is sent.
        otp.reserve_send(db, key)
    except RuntimeError as exc:
        raise upstream_error(
            500,
            "Email verification is not available",
            log="OTP hashing secret is missing",
            exc=exc,
        ) from exc
    code = otp.generate_code()
    try:
        rate_limit.enforce_identifier(db, "email_otp_send_user", str(current_user.id))
        send_contact_email_code(email, code)
    except HTTPException:
        otp.release_send(db, key)  # the per-user limit
        raise
    except Exception as exc:
        otp.release_send(db, key)
        raise upstream_error(
            502,
            "The verification email could not be sent",
            log="[email] Contact email code failed",
            exc=exc,
        ) from exc
    otp.store_code(db, key, code)
    return {"ok": True}


@router.post("/email/otp/verify")
def verify_email_otp(
    body: EmailOTPVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email = normalize_email(str(body.email))
    rate_limit.enforce(db, request, "email_otp_verify", email)
    try:
        otp.check_code(db, _key(current_user.id, email), body.otp)
        token = sign_token(
            {
                "purpose": MERCHANT_EMAIL_PURPOSE,
                "user_id": current_user.id,
                "email": email,
            },
            CONTACT_VERIFICATION_TTL,
        )
    except RuntimeError as exc:
        raise upstream_error(
            500,
            "Email verification is not available",
            log="Email verification secret is missing",
            exc=exc,
        ) from exc
    return {"ok": True, "verification_token": token}

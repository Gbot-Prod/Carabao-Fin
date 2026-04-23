from __future__ import annotations

import hmac
import os
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from passlib.context import CryptContext  # pip install passlib[bcrypt]
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.security import create_access_token
from app.models.mobile_credential import MobileCredential
from app.models.user import User

router = APIRouter()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class AuthSyncPayload(BaseModel):
    provider_user_id: str
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None


class AuthSyncResponse(BaseModel):
    ok: bool
    user_id: int
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600


@router.post("/auth/sync")
async def sync_auth(
    payload: AuthSyncPayload,
    db: Session = Depends(get_db),
    x_internal_auth_sync_secret: Optional[str] = Header(
        default=None,
        alias="X-Internal-Auth-Sync-Secret",
    ),
) -> AuthSyncResponse:
    expected_secret = os.getenv("AUTH_SYNC_SHARED_SECRET")
    if not expected_secret:
        raise HTTPException(
            status_code=500,
            detail="AUTH_SYNC_SHARED_SECRET is not configured",
        )

    if not hmac.compare_digest(x_internal_auth_sync_secret or "", expected_secret):
        raise HTTPException(status_code=401, detail="Unauthorized auth sync request")

    user = db.query(User).filter(User.external_auth_id == payload.provider_user_id).first()

    # Fallback by email so existing users can be linked to Better Auth without duplicates.
    if user is None:
        user = db.query(User).filter(User.email == payload.email).first()

    if user is None:
        user = User(
            external_auth_id=payload.provider_user_id,
            email=payload.email,
            first_name=payload.first_name,
            last_name=payload.last_name,
            phone_number=payload.phone_number,
        )
        db.add(user)
    else:
        user.external_auth_id = payload.provider_user_id
        user.email = payload.email
        user.first_name = payload.first_name
        user.last_name = payload.last_name
        user.phone_number = payload.phone_number

    db.commit()
    db.refresh(user)

    access_token = create_access_token(
        subject=user.external_auth_id,
        expires_minutes=60,
        extra_claims={
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
        },
    )
    return AuthSyncResponse(
        ok=True,
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        access_token=access_token,
    )


@router.get("/auth/me")
async def get_me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "external_auth_id": current_user.external_auth_id,
        "email": current_user.email,
        "first_name": current_user.first_name,
        "last_name": current_user.last_name,
        "phone_number": current_user.phone_number,
    }


class MobileSignUpPayload(BaseModel):
    email: EmailStr
    password: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class MobileSignInPayload(BaseModel):
    email: EmailStr
    password: str


@router.post("/auth/mobile/sign-up", response_model=AuthSyncResponse)
async def mobile_sign_up(
    payload: MobileSignUpPayload,
    db: Session = Depends(get_db),
) -> AuthSyncResponse:
    existing = db.query(User).filter(User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email,
        first_name=payload.first_name,
        last_name=payload.last_name,
        # Store hash in external_auth_id field temporarily — in production
        # add a dedicated password_hash column to the User model.
        external_auth_id=f"mobile:{uuid4().hex}",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    credential = MobileCredential(user_id=user.id, password_hash=pwd_context.hash(payload.password))
    db.add(credential)
    db.commit()

    access_token = create_access_token(
        subject=user.external_auth_id,
        expires_minutes=60 * 24 * 7,
        extra_claims={
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
        },
    )
    return AuthSyncResponse(
        ok=True,
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        access_token=access_token,
        expires_in=60 * 60 * 24 * 7,
    )


@router.post("/auth/mobile/sign-in", response_model=AuthSyncResponse)
async def mobile_sign_in(
    payload: MobileSignInPayload,
    db: Session = Depends(get_db),
) -> AuthSyncResponse:
    user = db.query(User).filter(User.email == payload.email).first()

    if not user or not user.external_auth_id:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    credential = db.query(MobileCredential).filter(MobileCredential.user_id == user.id).first()

    if credential is not None:
        if not pwd_context.verify(payload.password, credential.password_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")
    else:
        # Backward-compat for the earlier prototype that stored the bcrypt hash
        # directly in external_auth_id as "mobile:<hash>".
        if not user.external_auth_id.startswith("mobile:"):
            raise HTTPException(status_code=401, detail="Invalid email or password")
        stored_hash = user.external_auth_id[len("mobile:") :]
        if not pwd_context.verify(payload.password, stored_hash):
            raise HTTPException(status_code=401, detail="Invalid email or password")

    access_token = create_access_token(
        subject=user.external_auth_id,
        expires_minutes=60 * 24 * 7,
        extra_claims={
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
        },
    )
    return AuthSyncResponse(
        ok=True,
        user_id=user.id,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        access_token=access_token,
        expires_in=60 * 60 * 24 * 7,
    )


class MobileSetPasswordPayload(BaseModel):
    password: str


@router.post("/auth/mobile/set-password")
async def mobile_set_password(
    payload: MobileSetPasswordPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not payload.password or len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    credential = db.query(MobileCredential).filter(MobileCredential.user_id == current_user.id).first()
    hashed = pwd_context.hash(payload.password)

    if credential is None:
        credential = MobileCredential(user_id=current_user.id, password_hash=hashed)
        db.add(credential)
    else:
        credential.password_hash = hashed

    db.commit()
    return {"ok": True}

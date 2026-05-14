from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import unicodedata
from typing import Optional
from uuid import uuid4

import bcrypt as _bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.security import create_access_token
from app.models.mobile_credential import MobileCredential
from app.models.user import User

router = APIRouter(tags=["auth"])


def _bcrypt_hash(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def _bcrypt_verify(password: str, hashed: str) -> bool:
    return _bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


BETTER_AUTH_SCRYPT_PARAMS = {
    "n": 16384,
    "r": 16,  # @better-auth/utils uses r=16
    "p": 1,
    "dklen": 64,
}


class AuthSyncPayload(BaseModel):
    provider_user_id: str
    email: EmailStr
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None
    role: Optional[str] = None


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

    is_admin = payload.role == "admin"

    if user is None:
        user = User(
            external_auth_id=payload.provider_user_id,
            email=payload.email,
            first_name=payload.first_name,
            last_name=payload.last_name,
            phone_number=payload.phone_number,
            is_admin=is_admin,
        )
        db.add(user)
    else:
        user.external_auth_id = payload.provider_user_id
        user.email = payload.email
        if payload.first_name is not None:
            user.first_name = payload.first_name
        if payload.last_name is not None:
            user.last_name = payload.last_name
        if payload.phone_number is not None:
            user.phone_number = payload.phone_number
        if payload.role is not None:
            user.is_admin = is_admin

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


def _split_name(full_name: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not full_name:
        return None, None

    parts = full_name.strip().split()
    if not parts:
        return None, None

    first_name = parts[0]
    last_name = " ".join(parts[1:]) if len(parts) > 1 else None
    return first_name, last_name


def _find_better_auth_account(db: Session, email: str) -> Optional[tuple[str, Optional[str], str]]:
    row = db.execute(
        text(
            """
            SELECT u.id AS user_id, u.name AS name, a.password AS password_hash
            FROM "user" u
            JOIN account a ON a."userId" = u.id
            WHERE u.email = :email
              AND a.password IS NOT NULL
            ORDER BY a."updatedAt" DESC
            LIMIT 1
            """
        ),
        {"email": email},
    ).mappings().first()

    if row is None:
        print(f"[DEBUG] No BetterAuth account found for email: {email}")
        return None

    user_id = str(row["user_id"])
    name = row["name"]
    password_hash = str(row["password_hash"])
    print(f"[DEBUG] Found BetterAuth account for {email}: user_id={user_id}, name={name}")
    print(f"[DEBUG] Password hash format: {password_hash[:50]}...")
    return user_id, name, password_hash


def _verify_better_auth_password(hash_value: str, password: str) -> bool:
    try:
        salt_hex, stored_key_hex = hash_value.split(":", 1)
        print(f"[DEBUG] Salt (hex): {salt_hex[:30]}..., Key (hex): {stored_key_hex[:30]}...")
        # BetterAuth (@better-auth/utils) passes the hex salt string directly to scryptAsync
        # (noble-hashes converts it to UTF-8 bytes internally, so salt is 32 bytes not 16).
        # The key is hex-encoded output bytes.
        salt_bytes = salt_hex.encode("utf-8")
        stored_key_bytes = bytes.fromhex(stored_key_hex)
        print(f"[DEBUG] Salt bytes length: {len(salt_bytes)}, key length: {len(stored_key_bytes)}")
    except (ValueError, Exception) as e:
        print(f"[DEBUG] Failed to decode hash: {e}")
        return False

    try:
        # BetterAuth normalizes the password with NFKC before hashing
        normalized_password = unicodedata.normalize("NFKC", password)
        print(f"[DEBUG] Password received: {password[:20]}... (length: {len(password)})")
        print(f"[DEBUG] Calling scrypt with params: n={BETTER_AUTH_SCRYPT_PARAMS['n']}, r={BETTER_AUTH_SCRYPT_PARAMS['r']}, p={BETTER_AUTH_SCRYPT_PARAMS['p']}, dklen={BETTER_AUTH_SCRYPT_PARAMS['dklen']}")
        derived_key = hashlib.scrypt(
            normalized_password.encode("utf-8"),
            salt=salt_bytes,
            n=BETTER_AUTH_SCRYPT_PARAMS["n"],
            r=BETTER_AUTH_SCRYPT_PARAMS["r"],
            p=BETTER_AUTH_SCRYPT_PARAMS["p"],
            dklen=BETTER_AUTH_SCRYPT_PARAMS["dklen"],
            maxmem=256 * 1024 * 1024,
        )
        print(f"[DEBUG] Derived key: {derived_key.hex()[:30]}...")
        print(f"[DEBUG] Stored key:  {stored_key_hex[:30]}...")
        match = hmac.compare_digest(derived_key, stored_key_bytes)
        print(f"[DEBUG] Password match: {match}")
        return match
    except ValueError as e:
        print(f"[DEBUG] Scrypt error: {e}")
        return False


def _sync_backend_user_from_better_auth(
    db: Session,
    *,
    email: str,
    better_auth_user_id: str,
    full_name: Optional[str],
    password: str,
) -> User:
    first_name, last_name = _split_name(full_name)

    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(
            email=email,
            first_name=first_name,
            last_name=last_name,
            external_auth_id=better_auth_user_id,
        )
        db.add(user)
        db.flush()
    else:
        user.external_auth_id = better_auth_user_id
        if first_name is not None:
            user.first_name = first_name
        if last_name is not None:
            user.last_name = last_name

    credential = db.query(MobileCredential).filter(MobileCredential.user_id == user.id).first()
    backend_password_hash = _bcrypt_hash(password)
    if credential is None:
        credential = MobileCredential(user_id=user.id, password_hash=backend_password_hash)
        db.add(credential)
    else:
        credential.password_hash = backend_password_hash

    db.commit()
    db.refresh(user)
    return user


@router.post("/auth/mobile/sign-up", response_model=AuthSyncResponse)
async def mobile_sign_up(
    payload: MobileSignUpPayload,
    db: Session = Depends(get_db),
) -> AuthSyncResponse:
    if not payload.password or len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if len(payload.password.encode("utf-8")) > 72:
        raise HTTPException(status_code=400, detail="Password must be 72 characters or fewer")

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

    credential = MobileCredential(user_id=user.id, password_hash=_bcrypt_hash(payload.password))
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
    print(f"[DEBUG] mobile_sign_in called for email: {payload.email}")
    user = db.query(User).filter(User.email == payload.email).first()

    credential = None
    if user is not None:
        credential = db.query(MobileCredential).filter(MobileCredential.user_id == user.id).first()

    if credential is not None:
        if not _bcrypt_verify(payload.password, credential.password_hash):
            await asyncio.sleep(1)
            raise HTTPException(status_code=401, detail="Invalid email or password")
    else:
        if user is not None and user.external_auth_id and user.external_auth_id.startswith("mobile:"):
            # Backward-compat for the earlier prototype that stored the bcrypt hash
            # directly in external_auth_id as "mobile:<hash>".
            stored_hash = user.external_auth_id[len("mobile:") :]
            if not _bcrypt_verify(payload.password, stored_hash):
                await asyncio.sleep(1)
                raise HTTPException(status_code=401, detail="Invalid email or password")
        else:
            print(f"[DEBUG] Checking BetterAuth for email: {payload.email}")
            better_auth_account = _find_better_auth_account(db, payload.email)
            if better_auth_account is None:
                print(f"[DEBUG] BetterAuth account not found")
                await asyncio.sleep(1)
                raise HTTPException(status_code=401, detail="Invalid email or password")

            better_auth_user_id, better_auth_name, better_auth_password_hash = better_auth_account
            print(f"[DEBUG] Verifying password for BetterAuth user")
            if not _verify_better_auth_password(better_auth_password_hash, payload.password):
                print(f"[DEBUG] Password verification failed")
                await asyncio.sleep(1)
                raise HTTPException(status_code=401, detail="Invalid email or password")
            print(f"[DEBUG] Password verified successfully, syncing user")

            user = _sync_backend_user_from_better_auth(
                db,
                email=payload.email,
                better_auth_user_id=better_auth_user_id,
                full_name=better_auth_name,
                password=payload.password,
            )

    if user is None or not user.external_auth_id:
        await asyncio.sleep(1)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if user.external_auth_id.startswith("mobile:"):
        stored_hash = user.external_auth_id[len("mobile:") :]
        if not _bcrypt_verify(payload.password, stored_hash):
            await asyncio.sleep(1)
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
    hashed = _bcrypt_hash(payload.password)

    if credential is None:
        credential = MobileCredential(user_id=current_user.id, password_hash=hashed)
        db.add(credential)
    else:
        credential.password_hash = hashed

    db.commit()
    return {"ok": True}

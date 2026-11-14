"""Backend user rows for BetterAuth identities.

BetterAuth owns sign-in. The first request with a valid token creates the
matching ``backend_users`` row (or links an unclaimed row with the same email),
so there is no separate sync step. Profile fields (name, phone, Google photo)
are copied only once; after that the backend owns them and PATCH /users/me
writes them back to BetterAuth. Only a verified email change flows this way
later. Two-step verification is read live from BetterAuth, never stored here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.user import User, normalize_email
from app.services import better_auth_store

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Identity:
    subject: str
    email: str
    email_verified: bool
    name: str | None = None
    role: str | None = None
    phone_number: str | None = None
    image: str | None = None

    @classmethod
    def from_claims(cls, claims: dict[str, Any]) -> Identity:
        subject = claims.get("sub")
        email = claims.get("email")
        if not isinstance(subject, str) or not subject:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid access token subject",
            )
        if not isinstance(email, str) or "@" not in email:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid access token email",
            )

        def text(key: str) -> str | None:
            value = claims.get(key)
            return value.strip() or None if isinstance(value, str) else None

        return cls(
            subject=subject,
            email=normalize_email(email),
            email_verified=claims.get("emailVerified") is True,
            name=text("name"),
            role=text("role"),
            phone_number=text("phoneNumber"),
            image=text("image"),
        )


def _email_taken(db: Session, email: str, *, other_than: int | None = None) -> bool:
    q = db.query(User.id).filter(func.lower(User.email) == email)
    if other_than is not None:
        q = q.filter(User.id != other_than)
    return q.first() is not None


def _phone_taken(db: Session, phone: str) -> bool:
    return db.query(User.id).filter(User.phone_number == phone).first() is not None


def _provision(db: Session, identity: Identity) -> User:
    # BetterAuth only opens a session for a verified email (requireEmailVerification,
    # or the provider vouching for it), so an unverified identity here is unexpected.
    if not identity.email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Verify your email before using your account",
        )

    # A token outlives its BetterAuth user by up to 15 minutes; a deleted
    # account must not be recreated from it.
    if not better_auth_store.identity_exists(db, identity.subject):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account no longer exists",
        )

    is_admin = identity.role == "admin"
    existing = db.query(User).filter(func.lower(User.email) == identity.email).first()
    if existing is not None:
        # Linking hands the row to whoever proved the address, so only an
        # unclaimed row can be linked.
        if existing.external_auth_id is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email is already linked to another account",
            )
        user = existing
        user.external_auth_id = identity.subject
        user.name = user.name or identity.name
        user.profile_picture_url = user.profile_picture_url or identity.image
        if identity.role is not None:
            user.is_admin = is_admin
    else:
        phone = identity.phone_number
        user = User(
            external_auth_id=identity.subject,
            email=identity.email,
            name=identity.name,
            phone_number=phone if phone and not _phone_taken(db, phone) else None,
            is_admin=is_admin,
            # A Google sign-in's photo; uploads replace it later.
            profile_picture_url=identity.image,
        )
        db.add(user)

    try:
        db.commit()
    except IntegrityError:
        # The app's first screen fires several requests at once; another one
        # created the row first.
        db.rollback()
        user = db.query(User).filter(User.external_auth_id == identity.subject).first()
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This email is already linked to another account",
            ) from None
        return user
    db.refresh(user)
    return user


def _refresh(db: Session, user: User, identity: Identity) -> None:
    changed = False
    if identity.email_verified and normalize_email(user.email) != identity.email:
        if _email_taken(db, identity.email, other_than=user.id):
            logger.warning(
                "[auth] User %s: new email belongs to another row; kept the old one",
                user.id,
            )
        else:
            user.email = identity.email
            changed = True
    if changed:
        db.commit()
        db.refresh(user)


def resolve_user(db: Session, identity: Identity) -> User:
    user = db.query(User).filter(User.external_auth_id == identity.subject).first()
    if user is None:
        return _provision(db, identity)
    _refresh(db, user, identity)
    return user

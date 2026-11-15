"""Backend user rows for BetterAuth identities.

BetterAuth owns sign-in and every identity field (name, email, phone, role,
ban, 2FA); ``User`` reads them live from its "user" table. The backend row only
holds profile data and the integer id the rest of the schema points at, so the
first request with a valid token creates it and there is no sync step.

Neither email nor phone verification is required to use the API. A verified
phone is required for checkout, merchant applications and order chat
(app/api/dependencies.py require_verified_phone).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.auth_identity import AuthIdentity
from app.models.user import User


@dataclass(frozen=True)
class Identity:
    subject: str

    @classmethod
    def from_claims(cls, claims: dict[str, Any]) -> Identity:
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid access token subject",
            )
        return cls(subject=subject)


def _provision(db: Session, identity: Identity) -> User:
    # A token outlives its BetterAuth user by up to 15 minutes; a deleted
    # account must not be recreated from it.
    auth_user = db.get(AuthIdentity, identity.subject)
    if auth_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account no longer exists",
        )

    user = User(
        external_auth_id=identity.subject,
        notifications_preferences={},
        # A Google sign-in's photo; uploads replace it later.
        profile_picture_url=auth_user.image,
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
            raise
        return user
    db.refresh(user)
    return user


def resolve_user(db: Session, identity: Identity) -> User:
    user = db.query(User).filter(User.external_auth_id == identity.subject).first()
    if user is None:
        return _provision(db, identity)
    return user

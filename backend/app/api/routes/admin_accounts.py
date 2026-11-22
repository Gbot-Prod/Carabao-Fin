"""Admin accounts: invite, accept, resend, deactivate, reactivate
(app/services/admin_accounts.py, DB_ROLE_SPLIT_PLAN.md section 2).

Every admin-account write goes through these endpoints, so web-admin's own
database login only does what Better Auth needs for sign-in and TOTP setup.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_db, require_internal_secret
from app.api.routes.admin import _require_admin
from app.models.user import User
from app.schemas.user import UserResponse
from app.services import admin_accounts

router = APIRouter(tags=["admin"])


def _target(db: Session, user_id: int) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


class InvitePayload(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    name: str = Field(min_length=1, max_length=100)

    model_config = ConfigDict(extra="forbid")


class InviteResponse(BaseModel):
    user: UserResponse
    # Shown once to the inviting admin; only its hash is kept.
    code: str
    expires_at: datetime


@router.post("/admin/invites", response_model=InviteResponse, status_code=201)
def invite_admin(
    payload: InvitePayload,
    db: Session = Depends(get_db),
    current_admin: User = Depends(_require_admin),
):
    if not payload.name.strip():
        raise HTTPException(status_code=422, detail="A name is required")
    issued = admin_accounts.invite(
        db, actor=current_admin, email=payload.email, name=payload.name
    )
    return _invite_response(issued)


@router.post("/admin/invites/{user_id}/resend", response_model=InviteResponse)
def resend_admin_invite(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(_require_admin),
):
    issued = admin_accounts.resend(db, actor=current_admin, user=_target(db, user_id))
    return _invite_response(issued)


def _invite_response(issued: admin_accounts.IssuedInvite) -> InviteResponse:
    return InviteResponse(
        user=UserResponse.model_validate(issued.user).model_copy(
            update={"admin_invite_pending": True}
        ),
        code=issued.code,
        expires_at=issued.expires_at,
    )


class AcceptPayload(BaseModel):
    invite: str = Field(min_length=1, max_length=64)
    token: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=1, max_length=20)
    password: str = Field(min_length=1, max_length=admin_accounts.MAX_PASSWORD)

    model_config = ConfigDict(extra="forbid")


class AcceptResponse(BaseModel):
    email: str


@router.post("/admin/invites/accept", response_model=AcceptResponse)
def accept_admin_invite(
    payload: AcceptPayload, request: Request, db: Session = Depends(get_db)
):
    """Public (no session): the invite link's id and token, the code from the
    inviting admin, and the new password. Rate-limited per IP and invite."""
    email = admin_accounts.accept(
        db,
        request,
        invite_id=payload.invite,
        token=payload.token,
        code=payload.code,
        password=payload.password,
    )
    return {"email": email}


@router.post("/admin/admins/{user_id}/deactivate", response_model=UserResponse)
def deactivate_admin(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(_require_admin),
):
    return admin_accounts.deactivate(db, actor=current_admin, user=_target(db, user_id))


class ReactivateResponse(BaseModel):
    user: UserResponse
    sent_to: list[str]
    # Set when the account never accepted its invite: a fresh invite was made.
    invite_code: str | None = None


@router.post("/admin/admins/{user_id}/reactivate", response_model=ReactivateResponse)
def reactivate_admin(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(_require_admin),
):
    done = admin_accounts.reactivate(db, actor=current_admin, user=_target(db, user_id))
    return ReactivateResponse(
        user=UserResponse.model_validate(done.user).model_copy(
            update={"admin_invite_pending": done.invite_code is not None}
        ),
        sent_to=done.sent_to,
        invite_code=done.invite_code,
    )


class EnrolledPayload(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)

    model_config = ConfigDict(extra="forbid")


@router.post(
    "/admin/two-factor/enrolled",
    dependencies=[Depends(require_internal_secret)],
)
def two_factor_enrolled(payload: EnrolledPayload, db: Session = Depends(get_db)):
    """web-admin (lib/auth.ts) after /two-factor/verify-totp. Logs the setup
    only when the database already shows 2FA on for that admin."""
    return {"recorded": admin_accounts.record_enrolled(db, payload.user_id)}

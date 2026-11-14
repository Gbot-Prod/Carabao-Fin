"""Admin suspension of accounts (A3).

A suspension is a BetterAuth ban (admin plugin's ``banned`` / ``banReason``):
BetterAuth refuses sign-in and the ban deletes the user's sessions, so web and
app sign out at once. ``get_current_user`` reads the ban live too, so an access
token issued before it stops working immediately.
"""

from __future__ import annotations

from sqlalchemy import and_, exists, not_
from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.user import User
from app.services import audit_log, better_auth_store

SUSPENDED_DETAIL = "This account has been suspended. Contact Carabao support."


def suspended_detail(user: User) -> str:
    if user.suspension_reason:
        return f"{SUSPENDED_DETAIL} Reason: {user.suspension_reason}"
    return SUSPENDED_DETAIL


def merchant_is_public():
    """SQL filter: merchants buyers may see (not deleted, owner not suspended)."""
    return and_(
        Merchant.deleted_at.is_(None),
        not_(exists().where(User.id == Merchant.user_id, User.is_suspended)),
    )


def _suspension_state(user: User) -> dict:
    return {
        "is_suspended": user.is_suspended,
        "suspension_reason": user.suspension_reason,
    }


def suspend_user(db: Session, user: User, *, admin: User, reason: str) -> User:
    before = _suspension_state(user)
    better_auth_store.set_banned(
        db, user.external_auth_id, banned=True, reason=reason.strip()
    )
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.SUSPEND,
        target_type="user",
        target_id=user.id,
        before=before,
        after=_suspension_state(user),
    )
    db.commit()
    db.refresh(user)
    return user


def reinstate_user(db: Session, user: User, *, admin: User) -> User:
    before = _suspension_state(user)
    better_auth_store.set_banned(db, user.external_auth_id, banned=False, reason=None)
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.REINSTATE,
        target_type="user",
        target_id=user.id,
        before=before,
        after=_suspension_state(user),
    )
    db.commit()
    db.refresh(user)
    return user

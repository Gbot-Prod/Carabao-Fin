"""Admin suspension of accounts (A3).

The backend user row is the source of truth: ``get_current_user`` refuses a
suspended user on every request. The BetterAuth user is also banned and its
sessions deleted (better_auth_store), so sign-in stops at once on web and app.
"""

from __future__ import annotations

from datetime import UTC, datetime

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
        not_(
            exists().where(User.id == Merchant.user_id, User.suspended_at.isnot(None))
        ),
    )


def _suspension_state(user: User) -> dict:
    return {
        "suspended_at": user.suspended_at,
        "suspension_reason": user.suspension_reason,
    }


def suspend_user(db: Session, user: User, *, admin: User, reason: str) -> User:
    before = _suspension_state(user)
    user.suspended_at = datetime.now(UTC)
    user.suspension_reason = reason.strip()
    user.suspended_by = admin.id
    better_auth_store.set_banned(
        db, user.external_auth_id, banned=True, reason=user.suspension_reason
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
    user.suspended_at = None
    user.suspension_reason = None
    user.suspended_by = None
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

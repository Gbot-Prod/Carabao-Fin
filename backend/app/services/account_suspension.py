"""Admin suspension of accounts (A3).

The backend user row is the source of truth: ``get_current_user``, the web auth
sync and mobile sign-in all refuse a suspended user. The BetterAuth row is also
banned (admin plugin columns) and its sessions are deleted so the web session
ends immediately rather than when the backend token expires.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import and_, exists, not_, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.user import User

logger = logging.getLogger(__name__)

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


def _sync_better_auth_ban(db: Session, user: User, *, banned: bool) -> None:
    """Best effort: a missing BetterAuth table must not block the suspension."""
    if not user.external_auth_id or user.external_auth_id.startswith("mobile:"):
        return
    try:
        with db.begin_nested():
            db.execute(
                text(
                    'UPDATE "user" SET banned = :banned, "banReason" = :reason '
                    "WHERE id = :id"
                ),
                {
                    "banned": banned,
                    "reason": user.suspension_reason if banned else None,
                    "id": user.external_auth_id,
                },
            )
            if banned:
                db.execute(
                    text('DELETE FROM "session" WHERE "userId" = :id'),
                    {"id": user.external_auth_id},
                )
    except SQLAlchemyError as exc:
        logger.warning(
            "[suspension] Could not update BetterAuth ban for user %s: %s", user.id, exc
        )


def suspend_user(db: Session, user: User, *, admin: User, reason: str) -> User:
    user.suspended_at = datetime.now(UTC)
    user.suspension_reason = reason.strip()
    user.suspended_by = admin.id
    _sync_better_auth_ban(db, user, banned=True)
    db.commit()
    db.refresh(user)
    return user


def reinstate_user(db: Session, user: User) -> User:
    user.suspended_at = None
    user.suspension_reason = None
    user.suspended_by = None
    _sync_better_auth_ban(db, user, banned=False)
    db.commit()
    db.refresh(user)
    return user

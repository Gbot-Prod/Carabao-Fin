"""Record admin actions (A4).

``record_admin_action`` only adds the row; the caller's commit saves it together
with the change it describes, so an action is logged if and only if it happened.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from app.models.admin_audit_log import AdminAuditLog
from app.models.user import User

# No longer written: admins are invited, not promoted. Kept so older rows can
# still be filtered in the audit log.
ROLE_CHANGE = "user.role_change"
TWO_FACTOR_RESET = "user.two_factor_reset"
# Admin accounts (DB_ROLE_SPLIT_PLAN.md section 2).
ADMIN_INVITE = "admin.invite"
ADMIN_INVITE_RESENT = "admin.invite_resent"
ADMIN_INVITE_LOCKED = "admin.invite_locked"
ADMIN_INVITE_ACCEPTED = "admin.invite_accepted"
ADMIN_TWO_FACTOR_ENROLLED = "admin.two_factor_enrolled"
# Password, 2FA and sessions removed; a new invite sent. Replaces
# TWO_FACTOR_RESET for admins (older rows keep that action).
ADMIN_ACCOUNT_RESET = "admin.account_reset"
ADMIN_DEACTIVATE = "admin.deactivate"
ADMIN_REACTIVATE = "admin.reactivate"
ADMIN_CREATE = "admin.create"  # scripts/make_admin.py --create
ADMIN_RECOVER = "admin.recover"  # scripts/make_admin.py --recover
SUSPEND = "user.suspend"
REINSTATE = "user.reinstate"
APPLICATION_REVIEW = "merchant_application.review"
PAYOUT_RELEASE = "payout.release"
PAYOUT_REFRESH = "payout.refresh"  # only when the status changed (CF-0054)
REFUND = "transaction.refund"
PRODUCE_HIDE = "produce.hide"
PRODUCE_UNHIDE = "produce.unhide"
PRODUCE_APPROVE = "produce.approve"  # guardrails Phase 1
PRODUCE_REJECT = "produce.reject"
PENALTY_REVOKE = "listing_penalty.revoke"  # guardrails Phase 2
TERM_CREATE = "prohibited_term.create"
TERM_UPDATE = "prohibited_term.update"
REVIEW_HIDE = "review.hide"  # CF-0075
REVIEW_UNHIDE = "review.unhide"
ORDER_CANCEL = "order.cancel"  # CF-0045
REFERENCE_PRICES_IMPORT = "reference_prices.import"  # guardrails Phase 4
REFERENCE_PRICES_SYNC = "reference_prices.sync_da"

ACTIONS = (
    ROLE_CHANGE,
    TWO_FACTOR_RESET,
    ADMIN_INVITE,
    ADMIN_INVITE_RESENT,
    ADMIN_INVITE_LOCKED,
    ADMIN_INVITE_ACCEPTED,
    ADMIN_TWO_FACTOR_ENROLLED,
    ADMIN_ACCOUNT_RESET,
    ADMIN_DEACTIVATE,
    ADMIN_REACTIVATE,
    ADMIN_CREATE,
    ADMIN_RECOVER,
    SUSPEND,
    REINSTATE,
    APPLICATION_REVIEW,
    PAYOUT_RELEASE,
    REFUND,
    PRODUCE_HIDE,
    PRODUCE_UNHIDE,
    PRODUCE_APPROVE,
    PRODUCE_REJECT,
    PENALTY_REVOKE,
    TERM_CREATE,
    TERM_UPDATE,
    REVIEW_HIDE,
    REVIEW_UNHIDE,
    ORDER_CANCEL,
    REFERENCE_PRICES_IMPORT,
    REFERENCE_PRICES_SYNC,
)


def _jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(v) for v in value]
    return value


def record_admin_action(
    db: Session,
    *,
    admin: User,
    action: str,
    target_type: str,
    target_id: int | None,
    before: dict | None = None,
    after: dict | None = None,
) -> AdminAuditLog:
    entry = AdminAuditLog(
        admin_id=admin.id,
        # Who acted, as admins know them; phone-only accounts have no email.
        admin_email=admin.email or admin.phone_number or admin.external_auth_id or "",
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=_jsonable(before),
        after=_jsonable(after),
    )
    db.add(entry)
    return entry


# Who acted when no admin did: a server script (scripts/make_admin.py).
SYSTEM_ACTOR = "system"


def record_system_action(
    db: Session,
    *,
    action: str,
    target_type: str,
    target_id: int | None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> AdminAuditLog:
    """Like record_admin_action, with no admin: admin_id is empty and the actor
    is "system". Same rule: the caller's commit saves it with the change."""
    entry = AdminAuditLog(
        admin_id=None,
        admin_email=SYSTEM_ACTOR,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before=_jsonable(before),
        after=_jsonable(after),
    )
    db.add(entry)
    return entry

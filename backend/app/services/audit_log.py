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

ROLE_CHANGE = "user.role_change"
SUSPEND = "user.suspend"
REINSTATE = "user.reinstate"
APPLICATION_REVIEW = "merchant_application.review"
PAYOUT_RELEASE = "payout.release"
REFUND = "transaction.refund"
PRODUCE_HIDE = "produce.hide"
PRODUCE_UNHIDE = "produce.unhide"

ACTIONS = (
    ROLE_CHANGE,
    SUSPEND,
    REINSTATE,
    APPLICATION_REVIEW,
    PAYOUT_RELEASE,
    REFUND,
    PRODUCE_HIDE,
    PRODUCE_UNHIDE,
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

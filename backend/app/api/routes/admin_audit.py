"""Read-only view of the admin audit log (A4). There is no write endpoint."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.models.admin_audit_log import AdminAuditLog
from app.models.user import User
from app.schemas.audit_log import AuditLogEntry
from app.schemas.pagination import MAX_ID, MAX_PAGE, Page
from app.services.audit_log import ACTIONS

router = APIRouter(tags=["admin"])


@router.get("/admin/audit-log/actions", response_model=list[str])
def list_audit_actions(_: User = Depends(_require_admin)):
    return list(ACTIONS)


@router.get("/admin/audit-log", response_model=Page[AuditLogEntry])
def list_audit_log(
    # CF-0094 (B102): the columns are String(64) and String(32).
    action: str | None = Query(None, max_length=64),
    admin_id: int | None = Query(None, ge=1, le=MAX_ID),
    target_type: str | None = Query(None, max_length=32),
    target_id: int | None = Query(None, ge=0, le=MAX_ID),
    page: int = Query(1, ge=1, le=MAX_PAGE),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    q = db.query(AdminAuditLog)
    if action:
        q = q.filter(AdminAuditLog.action == action)
    if admin_id is not None:
        q = q.filter(AdminAuditLog.admin_id == admin_id)
    if target_type:
        q = q.filter(AdminAuditLog.target_type == target_type)
    if target_id is not None:
        q = q.filter(AdminAuditLog.target_id == target_id)
    total = q.count()
    items = (
        q.order_by(AdminAuditLog.created_at.desc(), AdminAuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}

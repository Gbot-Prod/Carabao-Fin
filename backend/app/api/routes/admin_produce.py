"""Admin listing moderation (A6): browse every listing, hide or unhide one."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.models.produce import Produce
from app.models.user import User
from app.schemas.pagination import Page
from app.schemas.produce import ProduceResponse
from app.services import audit_log

router = APIRouter(tags=["admin"])


class AdminProduceResponse(ProduceResponse):
    merchant_name: str | None = None


class HidePayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def _view(produce: Produce) -> AdminProduceResponse:
    return AdminProduceResponse.model_validate(produce).model_copy(
        update={
            "merchant_name": produce.merchant.merchant_name
            if produce.merchant
            else None
        }
    )


def _moderation_state(produce: Produce) -> dict:
    return {"hidden_at": produce.hidden_at, "hidden_reason": produce.hidden_reason}


@router.get("/admin/produce", response_model=Page[AdminProduceResponse])
def list_all_produce(
    merchant_id: int | None = None,
    hidden: bool | None = None,
    q: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    query = db.query(Produce)
    if merchant_id is not None:
        query = query.filter(Produce.merchant_id == merchant_id)
    if hidden is True:
        query = query.filter(Produce.hidden_at.isnot(None))
    elif hidden is False:
        query = query.filter(Produce.hidden_at.is_(None))
    if q and q.strip():
        query = query.filter(Produce.name.ilike(f"%{q.strip()}%"))
    total = query.count()
    rows = (
        query.options(joinedload(Produce.merchant))
        .order_by(Produce.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [_view(p) for p in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def _get(db: Session, produce_id: int) -> Produce:
    produce = db.get(Produce, produce_id)
    if produce is None:
        raise HTTPException(status_code=404, detail="Listing not found")
    return produce


@router.post("/admin/produce/{produce_id}/hide", response_model=AdminProduceResponse)
def hide_produce(
    produce_id: int,
    payload: HidePayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="A reason is required")
    produce = _get(db, produce_id)
    if produce.hidden_at is not None:
        raise HTTPException(status_code=409, detail="Listing is already hidden")
    before = _moderation_state(produce)
    produce.hidden_at = datetime.now(UTC)
    produce.hidden_reason = reason
    produce.hidden_by = admin.id
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.PRODUCE_HIDE,
        target_type="produce",
        target_id=produce.id,
        before=before,
        after=_moderation_state(produce),
    )
    db.commit()
    db.refresh(produce)
    return _view(produce)


@router.post("/admin/produce/{produce_id}/unhide", response_model=AdminProduceResponse)
def unhide_produce(
    produce_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    produce = _get(db, produce_id)
    if produce.hidden_at is None:
        raise HTTPException(status_code=409, detail="Listing is not hidden")
    before = _moderation_state(produce)
    produce.hidden_at = None
    produce.hidden_reason = None
    produce.hidden_by = None
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.PRODUCE_UNHIDE,
        target_type="produce",
        target_id=produce.id,
        before=before,
        after=_moderation_state(produce),
    )
    db.commit()
    db.refresh(produce)
    return _view(produce)

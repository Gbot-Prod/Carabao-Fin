"""Admin review moderation (CF-0075, B22): find reviews, hide or restore one.

A hidden review stays in the database (the buyer wrote it, the order keeps
it) but leaves every public list, the farm's own list and the farm rating.
Each hide / restore writes an audit row with the reason.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.core.sql import SortOrder, ilike_contains, sort_clauses
from app.models.merchant import Merchant
from app.models.review import Review
from app.models.user import User
from app.schemas.pagination import MAX_ID, MAX_PAGE, Page
from app.services import audit_log
from app.services.review_service import recompute_merchant_rating, reviewer_display_name

router = APIRouter(tags=["admin"])


class AdminReviewResponse(BaseModel):
    id: int
    order_id: int | None
    merchant_id: int
    merchant_name: str | None
    # First name + initial, as on the farm page; admins can open the order.
    reviewer_name: str
    rating: int
    comment: str | None
    merchant_reply: str | None
    created_at: datetime
    hidden_at: datetime | None
    hidden_reason: str | None


class HideReviewPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)

    model_config = ConfigDict(extra="forbid")


def _view(review: Review) -> AdminReviewResponse:
    return AdminReviewResponse(
        id=cast(int, review.id),
        order_id=cast(Any, review.order_id),
        merchant_id=cast(int, review.merchant_id),
        merchant_name=review.merchant.merchant_name if review.merchant else None,
        reviewer_name=reviewer_display_name(review.user),
        rating=cast(int, review.rating),
        comment=cast(Any, review.comment),
        merchant_reply=cast(Any, review.merchant_reply),
        created_at=cast(datetime, review.created_at),
        hidden_at=cast(Any, review.hidden_at),
        hidden_reason=cast(Any, review.hidden_reason),
    )


def _state(review: Review) -> dict[str, Any]:
    return {"hidden_at": review.hidden_at, "hidden_reason": review.hidden_reason}


# The columns the admin reviews table can be sorted on.
ReviewSort = Literal["date", "farm", "rating"]
_REVIEW_SORT_COLUMNS = {
    "date": Review.created_at,
    "farm": func.lower(Merchant.merchant_name),
    "rating": Review.rating,
}


@router.get("/admin/reviews", response_model=Page[AdminReviewResponse])
def list_reviews(
    hidden: bool | None = None,
    max_rating: int | None = Query(None, ge=1, le=5),
    merchant_id: int | None = Query(None, ge=1, le=MAX_ID),
    q: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1, le=MAX_PAGE),
    page_size: int = Query(20, ge=1, le=100),
    sort: ReviewSort = "date",
    order: SortOrder = "desc",
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
) -> dict[str, Any]:
    """Newest first by default. ``max_rating=2`` is the usual moderation queue."""
    query = db.query(Review)
    if hidden is True:
        query = query.filter(Review.hidden_at.isnot(None))
    elif hidden is False:
        query = query.filter(Review.hidden_at.is_(None))
    if max_rating is not None:
        query = query.filter(cast(Any, Review.rating) <= max_rating)
    if merchant_id is not None:
        query = query.filter(Review.merchant_id == merchant_id)
    if q and q.strip():
        query = query.filter(ilike_contains(Review.comment, q.strip()))
    total = query.count()
    if sort == "farm":
        query = query.outerjoin(Merchant, Review.merchant_id == Merchant.id)
    rows = (
        query.options(selectinload(Review.user), selectinload(Review.merchant))
        .order_by(*sort_clauses(_REVIEW_SORT_COLUMNS[sort], order, Review.id))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [_view(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


def _get(db: Session, review_id: int) -> Review:
    review = db.get(Review, review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    return review


def _set_hidden(
    db: Session, review: Review, admin: User, hidden: bool, reason: str | None
) -> None:
    before = _state(review)
    # Bulk UPDATE that keeps updated_at: it marks the buyer's own edits.
    db.query(Review).filter(Review.id == review.id).update(
        {
            Review.hidden_at: datetime.now(UTC) if hidden else None,
            Review.hidden_reason: reason if hidden else None,
            Review.hidden_by: admin.id if hidden else None,
            Review.updated_at: Review.updated_at,
        },
        synchronize_session=False,
    )
    db.refresh(review)
    recompute_merchant_rating(db, cast(int, review.merchant_id))
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.REVIEW_HIDE if hidden else audit_log.REVIEW_UNHIDE,
        target_type="review",
        target_id=cast(int, review.id),
        before=before,
        after=_state(review),
    )
    db.commit()
    db.refresh(review)


@router.post("/admin/reviews/{review_id}/hide", response_model=AdminReviewResponse)
def hide_review(
    review_id: int,
    payload: HideReviewPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
) -> AdminReviewResponse:
    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="A reason is required")
    review = _get(db, review_id)
    if review.hidden_at is not None:
        raise HTTPException(status_code=409, detail="Review is already hidden")
    _set_hidden(db, review, admin, True, reason)
    return _view(review)


@router.post("/admin/reviews/{review_id}/unhide", response_model=AdminReviewResponse)
def unhide_review(
    review_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
) -> AdminReviewResponse:
    review = _get(db, review_id)
    if review.hidden_at is None:
        raise HTTPException(status_code=409, detail="Review is not hidden")
    _set_hidden(db, review, admin, False, None)
    return _view(review)

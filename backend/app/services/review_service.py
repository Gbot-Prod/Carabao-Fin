"""Rules for buyer reviews and the merchant rating they feed.

A buyer may review an order once it is delivered (confirmed by them or by the
auto-confirm sweep), for ``REVIEW_WINDOW_DAYS`` after delivery. Edits are
allowed within the same window. ``Merchant.rating``/``rating_count`` are a
cache of the reviews table, recomputed on every write.
"""

import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.review import Review
from app.models.user import split_name
from app.schemas.review import PublicReviewResponse, ReviewResponse


class ReviewError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def review_window_days() -> int:
    """Days after delivery during which a buyer may create or edit a review."""
    return int(os.getenv("REVIEW_WINDOW_DAYS", "30"))


def review_deadline(order) -> datetime | None:
    delivered_at = order.delivered_at
    if delivered_at is None:
        return None
    if delivered_at.tzinfo is None:  # SQLite drops tzinfo; values are UTC.
        delivered_at = delivered_at.replace(tzinfo=UTC)
    return delivered_at + timedelta(days=review_window_days())


def ensure_reviewable(order, now: datetime | None = None) -> None:
    """Raise ReviewError unless this order may be reviewed (or re-edited) now."""
    if order.status != "delivered" or order.delivered_at is None:
        raise ReviewError(400, "Only delivered orders can be reviewed")
    if order.merchant_id is None:
        raise ReviewError(400, "This merchant is no longer on Carabao")
    deadline = review_deadline(order)
    if (now or datetime.now(UTC)) > deadline:
        raise ReviewError(400, "The review window for this order has closed")


def reviewer_display_name(user) -> str:
    """First name plus last initial, so reviews don't expose full names."""
    if user is None:
        return "Former buyer"
    first, last = split_name(user.name)
    if first and last:
        return f"{first} {last[0].upper()}."
    return first or "Carabao buyer"


def recompute_merchant_rating(db: Session, merchant_id: int) -> Merchant | None:
    """Refresh the cached average and count from the reviews table.

    The merchant row lock serialises concurrent reviews of the same merchant,
    so the last committer always sees every review.
    """
    merchant = (
        db.query(Merchant).filter(Merchant.id == merchant_id).with_for_update().first()
    )
    if merchant is None:
        return None
    db.flush()
    average, count = (
        db.query(func.avg(Review.rating), func.count(Review.id))
        .filter(Review.merchant_id == merchant_id)
        .one()
    )
    merchant.rating = round(float(average), 2) if count else None
    merchant.rating_count = int(count)
    return merchant


def can_review(order, now: datetime | None = None) -> bool:
    try:
        ensure_reviewable(order, now)
    except ReviewError:
        return False
    return True


def to_review_response(review: Review, order=None) -> ReviewResponse:
    """Serialize a review; ``editable_until`` is only known with its order."""
    return ReviewResponse(
        id=review.id,
        order_id=review.order_id,
        merchant_id=review.merchant_id,
        rating=review.rating,
        comment=review.comment,
        reviewer_name=reviewer_display_name(review.user),
        created_at=review.created_at,
        updated_at=review.updated_at,
        editable_until=review_deadline(order) if order is not None else None,
    )


def to_public_review_response(review: Review) -> PublicReviewResponse:
    """Serialize a review for the public shop page, without its order."""
    return PublicReviewResponse(
        id=review.id,
        merchant_id=review.merchant_id,
        rating=review.rating,
        comment=review.comment,
        reviewer_name=reviewer_display_name(review.user),
        created_at=review.created_at,
        updated_at=review.updated_at,
    )

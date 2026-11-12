from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.review import Review
from app.models.user import User
from app.schemas.review import (
    MerchantReviewsResponse,
    MyMerchantReviewsResponse,
    ReviewCreate,
    ReviewResponse,
    ReviewUpdate,
)
from app.services import notifications
from app.services.merchant_service import get_active_merchant
from app.services.review_service import (
    ReviewError,
    ensure_reviewable,
    recompute_merchant_rating,
    to_public_review_response,
    to_review_response,
)

router = APIRouter()


def _get_my_order(db: Session, order_id: int, user: User) -> Order:
    order = (
        db.query(Order)
        .join(OrderHistory, OrderHistory.id == Order.order_history_id)
        .filter(Order.id == order_id, OrderHistory.user_id == user.id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _get_order_review(db: Session, order_id: int) -> Review | None:
    return (
        db.query(Review)
        .options(selectinload(Review.user))
        .filter(Review.order_id == order_id)
        .first()
    )


@router.get("/orders/me/{order_id}/review", response_model=ReviewResponse)
def get_my_order_review(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = _get_my_order(db, order_id, current_user)
    review = _get_order_review(db, order.id)
    if review is None:
        raise HTTPException(status_code=404, detail="This order has no review yet")
    return to_review_response(review, order)


@router.post(
    "/orders/me/{order_id}/review", response_model=ReviewResponse, status_code=201
)
def create_order_review(
    order_id: int,
    payload: ReviewCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Buyer rates the merchant of a delivered order. One review per order."""
    order = _get_my_order(db, order_id, current_user)
    try:
        ensure_reviewable(order)
    except ReviewError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if _get_order_review(db, order.id) is not None:
        raise HTTPException(status_code=409, detail="This order is already reviewed")

    review = Review(
        order_id=order.id,
        user_id=current_user.id,
        merchant_id=order.merchant_id,
        rating=payload.rating,
        comment=payload.comment,
    )
    db.add(review)
    notifications.notify(
        db,
        notifications.merchant_user_id(order),
        notifications.REVIEW_RECEIVED,
        f"New {payload.rating}-star review",
        (payload.comment or "")[:200] or None,
        "/merchantDashboard",
    )
    try:
        recompute_merchant_rating(db, order.merchant_id)
        db.commit()
    except IntegrityError as exc:
        # Lost a race with a concurrent submit for the same order.
        db.rollback()
        raise HTTPException(
            status_code=409, detail="This order is already reviewed"
        ) from exc

    db.refresh(review)
    return to_review_response(review, order)


@router.patch("/orders/me/{order_id}/review", response_model=ReviewResponse)
def update_order_review(
    order_id: int,
    payload: ReviewUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Buyer edits their review while the review window is still open."""
    order = _get_my_order(db, order_id, current_user)
    review = _get_order_review(db, order.id)
    if review is None:
        raise HTTPException(status_code=404, detail="This order has no review yet")
    try:
        ensure_reviewable(order)
    except ReviewError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    changes = payload.model_dump(exclude_unset=True)
    if "rating" in changes and changes["rating"] is None:
        raise HTTPException(status_code=422, detail="Rating can't be removed")
    for field, value in changes.items():
        setattr(review, field, value)

    if "rating" in changes:
        recompute_merchant_rating(db, review.merchant_id)
    db.commit()
    db.refresh(review)
    return to_review_response(review, order)


# Registered before /merchants/{merchant_id}/reviews so "me" isn't parsed as an id.
@router.get("/merchants/me/reviews", response_model=MyMerchantReviewsResponse)
def list_my_merchant_reviews(
    rating: list[int] | None = Query(
        default=None, description="Only these star ratings; repeat to pass several"
    ),
    has_comment: bool | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The signed-in merchant's reviews, newest first, linked to their orders."""
    merchant = get_active_merchant(db, current_user.id)
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    if rating and any(stars < 1 or stars > 5 for stars in rating):
        raise HTTPException(status_code=422, detail="Ratings must be 1 to 5")

    breakdown = dict.fromkeys(range(1, 6), 0)
    for stars, count in (
        db.query(Review.rating, func.count(Review.id))
        .filter(Review.merchant_id == merchant.id)
        .group_by(Review.rating)
        .all()
    ):
        breakdown[int(stars)] = int(count)
    with_comment_count = (
        db.query(func.count(Review.id))
        .filter(Review.merchant_id == merchant.id, Review.comment.isnot(None))
        .scalar()
        or 0
    )

    query = db.query(Review).filter(Review.merchant_id == merchant.id)
    if rating:
        query = query.filter(Review.rating.in_(rating))
    if has_comment is True:
        query = query.filter(Review.comment.isnot(None))
    elif has_comment is False:
        query = query.filter(Review.comment.is_(None))
    total = query.count()
    reviews = (
        query.options(selectinload(Review.user))
        .order_by(Review.created_at.desc(), Review.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return MyMerchantReviewsResponse(
        merchant_id=merchant.id,
        rating=merchant.rating,
        rating_count=merchant.rating_count or 0,
        rating_breakdown=breakdown,
        with_comment_count=int(with_comment_count),
        total=int(total),
        reviews=[to_review_response(review) for review in reviews],
        limit=limit,
        offset=offset,
    )


@router.get("/merchants/{merchant_id}/reviews", response_model=MerchantReviewsResponse)
def list_merchant_reviews(
    merchant_id: int,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """Public, newest-first list of a merchant's reviews with the summary."""
    merchant = db.query(Merchant).filter(Merchant.id == merchant_id).first()
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant not found")

    reviews = (
        db.query(Review)
        .options(selectinload(Review.user))
        .filter(Review.merchant_id == merchant_id)
        .order_by(Review.created_at.desc(), Review.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return MerchantReviewsResponse(
        merchant_id=merchant.id,
        rating=merchant.rating,
        rating_count=merchant.rating_count or 0,
        reviews=[to_public_review_response(review) for review in reviews],
        limit=limit,
        offset=offset,
    )

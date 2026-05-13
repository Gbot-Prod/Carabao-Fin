from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import cast, Date, func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.order import Order
from app.models.payout_batch import PayoutBatch
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.merchant_application import ApplicationReviewPayload, MerchantApplicationResponse
from app.schemas.payment import PayoutBatchResponse
from app.schemas.user import UserResponse

router = APIRouter(tags=["admin"])


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return current_user


@router.get("/admin/users", response_model=list[UserResponse])
def list_all_users(
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    return db.query(User).order_by(User.id.asc()).all()


@router.get("/admin/merchant-applications", response_model=list[MerchantApplicationResponse])
def list_all_merchant_applications(
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    return (
        db.query(MerchantApplication)
        .order_by(MerchantApplication.submitted_at.desc())
        .all()
    )


@router.get("/admin/stats")
def get_admin_stats(
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    total_revenue = db.query(func.coalesce(func.sum(Transaction.amount), 0)).filter(Transaction.status == "paid").scalar() or 0
    platform_fees = db.query(func.coalesce(func.sum(Transaction.platform_fee), 0)).filter(Transaction.status == "paid").scalar() or 0
    total_orders = db.query(func.count(Order.id)).scalar() or 0
    total_users = db.query(func.count(User.id)).scalar() or 0
    active_merchants = db.query(func.count(Merchant.id)).scalar() or 0
    pending_applications = (
        db.query(func.count(MerchantApplication.id))
        .filter(MerchantApplication.status == "submitted")
        .scalar() or 0
    )

    since = datetime.now(timezone.utc) - timedelta(days=30)
    daily_rows = (
        db.query(
            cast(func.date_trunc("day", Transaction.paid_at), Date).label("date"),
            func.sum(Transaction.amount).label("revenue"),
            func.sum(Transaction.platform_fee).label("platform_fee"),
        )
        .filter(Transaction.status == "paid", Transaction.paid_at >= since)
        .group_by(cast(func.date_trunc("day", Transaction.paid_at), Date))
        .order_by(cast(func.date_trunc("day", Transaction.paid_at), Date))
        .all()
    )

    order_rows = (
        db.query(Order.status, func.count(Order.id).label("count"))
        .group_by(Order.status)
        .all()
    )

    payout_rows = (
        db.query(
            PayoutBatch.status,
            func.count(PayoutBatch.id).label("count"),
            func.coalesce(func.sum(PayoutBatch.gross_amount), 0).label("total_amount"),
        )
        .group_by(PayoutBatch.status)
        .all()
    )

    return {
        "total_revenue": int(total_revenue),
        "platform_fees": int(platform_fees),
        "total_orders": int(total_orders),
        "total_users": int(total_users),
        "active_merchants": int(active_merchants),
        "pending_applications": int(pending_applications),
        "daily_revenue": [
            {"date": str(r.date), "revenue": int(r.revenue), "platform_fee": int(r.platform_fee)}
            for r in daily_rows
        ],
        "order_breakdown": [
            {"status": r.status, "count": int(r.count)}
            for r in order_rows
        ],
        "payout_summary": [
            {"status": r.status, "count": int(r.count), "total_amount": int(r.total_amount)}
            for r in payout_rows
        ],
    }


@router.get("/admin/batches", response_model=list[PayoutBatchResponse])
def list_payout_batches(
    status: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    q = db.query(PayoutBatch)
    if status:
        q = q.filter(PayoutBatch.status == status)
    return q.order_by(PayoutBatch.period_date.desc()).all()


_REVIEW_STATUSES = {"approved", "rejected", "clarification"}


@router.patch("/admin/merchant-applications/{app_id}", response_model=MerchantApplicationResponse)
def review_merchant_application(
    app_id: int,
    payload: ApplicationReviewPayload,
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    if payload.status not in _REVIEW_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Status must be one of: {', '.join(sorted(_REVIEW_STATUSES))}",
        )
    application = db.query(MerchantApplication).filter(MerchantApplication.id == app_id).first()
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    application.status = payload.status
    application.admin_note = payload.admin_note
    db.commit()
    db.refresh(application)
    return application

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import Date, cast, func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.order import Order
from app.models.payout_batch import PayoutBatch, PayoutBatchItem
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.merchant import MerchantResponse
from app.schemas.merchant_application import (
    ApplicationReviewPayload,
    MerchantApplicationResponse,
)
from app.schemas.pagination import Page
from app.schemas.payment import PayoutBatchResponse
from app.schemas.user import UserResponse
from app.services import r2_service
from app.services.merchant_service import create_merchant_from_application

router = APIRouter(tags=["admin"])


def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return current_user


class RolePayload(BaseModel):
    is_admin: bool


@router.patch("/admin/users/{user_id}/role", response_model=UserResponse)
def set_user_admin_role(
    user_id: int,
    payload: RolePayload,
    db: Session = Depends(get_db),
    current_admin: User = Depends(_require_admin),
):
    if current_admin.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_admin = payload.is_admin
    if user.external_auth_id:
        ba_role = "admin" if payload.is_admin else "user"
        db.execute(
            text('UPDATE "user" SET role = :role WHERE id = :ba_id'),
            {"role": ba_role, "ba_id": user.external_auth_id},
        )
    db.commit()
    db.refresh(user)
    return user


@router.get("/admin/users", response_model=Page[UserResponse])
def list_all_users(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    q = db.query(User)
    total = q.count()
    items = (
        q.order_by(User.id.asc()).offset((page - 1) * page_size).limit(page_size).all()
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/admin/merchants", response_model=Page[MerchantResponse])
def list_all_merchants(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    q = (
        db.query(Merchant)
        .outerjoin(MerchantApplication, MerchantApplication.user_id == Merchant.user_id)
        .filter(
            or_(
                MerchantApplication.id.is_(None),
                MerchantApplication.status != "rejected",
            )
        )
    )
    total = q.count()
    items = (
        q.order_by(Merchant.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get(
    "/admin/merchant-applications", response_model=list[MerchantApplicationResponse]
)
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
    total_revenue = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(Transaction.status == "paid")
        .scalar()
        or 0
    )
    platform_fees = (
        db.query(func.coalesce(func.sum(Transaction.platform_fee), 0))
        .filter(Transaction.status == "paid")
        .scalar()
        or 0
    )
    total_orders = db.query(func.count(Order.id)).scalar() or 0
    total_users = db.query(func.count(User.id)).scalar() or 0
    active_merchants = db.query(func.count(Merchant.id)).scalar() or 0
    pending_applications = (
        db.query(func.count(MerchantApplication.id))
        .filter(MerchantApplication.status == "submitted")
        .scalar()
        or 0
    )

    since = datetime.now(UTC) - timedelta(days=30)
    # Plain cast (no bound params) so SELECT and GROUP BY match under psycopg3.
    paid_day = cast(Transaction.paid_at, Date)
    daily_rows = (
        db.query(
            paid_day.label("date"),
            func.sum(Transaction.amount).label("revenue"),
            func.sum(Transaction.platform_fee).label("platform_fee"),
        )
        .filter(Transaction.status == "paid", Transaction.paid_at >= since)
        .group_by(paid_day)
        .order_by(paid_day)
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
            {
                "date": str(r.date),
                "revenue": int(r.revenue),
                "platform_fee": int(r.platform_fee),
            }
            for r in daily_rows
        ],
        "order_breakdown": [
            {"status": r.status, "count": int(r.count)} for r in order_rows
        ],
        "payout_summary": [
            {
                "status": r.status,
                "count": int(r.count),
                "total_amount": int(r.total_amount),
            }
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


@router.post("/admin/batches/generate", response_model=list[PayoutBatchResponse])
def generate_payout_batches(
    period: date | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Groups paid, unbatched transactions of delivered orders for the given date
    (defaults to today) into per-merchant batches."""
    target_date = period or date.today()
    start_dt = datetime(
        target_date.year, target_date.month, target_date.day, tzinfo=UTC
    )
    end_dt = start_dt + timedelta(days=1)

    unbatched = (
        db.query(Transaction)
        .join(Order, Order.id == Transaction.order_id)
        .outerjoin(PayoutBatchItem, PayoutBatchItem.transaction_id == Transaction.id)
        .filter(
            Transaction.status == "paid",
            Order.status == "delivered",
            Order.delivered_at.isnot(None),
            Transaction.paid_at >= start_dt,
            Transaction.paid_at < end_dt,
            PayoutBatchItem.id.is_(None),
        )
        .all()
    )

    if not unbatched:
        return []

    # Group by merchant
    by_merchant: dict[int, list[Transaction]] = {}
    for txn in unbatched:
        by_merchant.setdefault(txn.merchant_id, []).append(txn)

    batches = []
    for merchant_id, txns in by_merchant.items():
        batch = PayoutBatch(
            merchant_id=merchant_id,
            period_date=target_date,
            transaction_count=len(txns),
            gross_amount=sum(t.merchant_amount for t in txns),
            status="pending",
        )
        db.add(batch)
        db.flush()

        for txn in txns:
            db.add(
                PayoutBatchItem(
                    batch_id=batch.id,
                    transaction_id=txn.id,
                    amount=txn.merchant_amount,
                )
            )

        batches.append(batch)

    db.commit()
    for b in batches:
        db.refresh(b)
    return batches


@router.patch("/admin/batches/{batch_id}/release", response_model=PayoutBatchResponse)
def release_payout_batch(
    batch_id: int,
    notes: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    batch = db.query(PayoutBatch).filter(PayoutBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    if batch.status == "released":
        raise HTTPException(status_code=400, detail="Batch already released")

    batch.status = "released"
    batch.released_at = datetime.now(UTC)
    if notes:
        batch.notes = notes

    db.commit()
    db.refresh(batch)
    return batch


@router.patch(
    "/admin/merchant-applications/{app_id}", response_model=MerchantApplicationResponse
)
def review_merchant_application(
    app_id: int,
    payload: ApplicationReviewPayload,
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    application = (
        db.query(MerchantApplication).filter(MerchantApplication.id == app_id).first()
    )
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    application.status = payload.status
    application.admin_note = payload.admin_note

    if payload.status == "approved" and application.merchant_id is None:
        try:
            merchant = create_merchant_from_application(db, application)
            application.merchant_id = merchant.id
        except (ValueError, IntegrityError) as exc:
            db.rollback()
            raise HTTPException(
                status_code=400, detail="Failed to create merchant profile"
            ) from exc

    db.commit()
    db.refresh(application)
    return application


@router.get("/admin/merchant-applications/{app_id}/rsbsa-document")
def get_rsbsa_document_url(
    app_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    application = (
        db.query(MerchantApplication).filter(MerchantApplication.id == app_id).first()
    )

    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    if not application.rsbsa_document_path:
        raise HTTPException(status_code=404, detail="RSBSA document not found")

    try:
        url = r2_service.create_rsbsa_document_url(
            application.rsbsa_document_path,
            application.rsbsa_document_content_type,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Unable to prepare RSBSA document",
        ) from exc
    if not url:
        raise HTTPException(
            status_code=502,
            detail="Unable to prepare RSBSA document",
        )

    return {
        "url": url,
        "filename": application.rsbsa_document_original_name,
        "content_type": application.rsbsa_document_content_type,
    }

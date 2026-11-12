from datetime import UTC, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import Date, cast, func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.payout_batch import PayoutBatch
from app.models.statuses import PayoutStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.merchant import AdminMerchantResponse
from app.schemas.merchant_application import (
    ApplicationReviewPayload,
    MerchantApplicationResponse,
)
from app.schemas.pagination import Page
from app.schemas.payout import (
    AdminPayoutBatchResponse,
    PayoutDestinationPreview,
    WalletBalance,
)
from app.schemas.user import UserResponse
from app.services import audit_log, paymongo, r2_service
from app.services.account_suspension import reinstate_user, suspend_user
from app.services.merchant_service import create_merchant_from_application
from app.services.produce_freshness import PH_TZ
from app.services.payout_service import (
    PayoutError,
    get_payout_info,
    payout_info_problem,
    refresh_payout,
    resolve_destination,
    send_payout,
    transfer_fee,
)

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

    before = {"is_admin": bool(user.is_admin)}
    user.is_admin = payload.is_admin
    audit_log.record_admin_action(
        db,
        admin=current_admin,
        action=audit_log.ROLE_CHANGE,
        target_type="user",
        target_id=user.id,
        before=before,
        after={"is_admin": payload.is_admin},
    )
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


@router.get("/admin/merchants", response_model=Page[AdminMerchantResponse])
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
    merchants = (
        q.options(selectinload(Merchant.user))
        .order_by(Merchant.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    items = [
        AdminMerchantResponse.model_validate(m).model_copy(
            update={
                "owner_suspended_at": m.user.suspended_at if m.user else None,
                "owner_suspension_reason": (
                    m.user.suspension_reason if m.user else None
                ),
            }
        )
        for m in merchants
    ]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


class SuspendPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def _get_other_user(db: Session, user_id: int, admin: User) -> User:
    if admin.id == user_id:
        raise HTTPException(status_code=400, detail="You cannot suspend yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/admin/users/{user_id}/suspend", response_model=UserResponse)
def suspend_account(
    user_id: int,
    payload: SuspendPayload,
    db: Session = Depends(get_db),
    current_admin: User = Depends(_require_admin),
):
    if not payload.reason.strip():
        raise HTTPException(status_code=422, detail="A reason is required")
    user = _get_other_user(db, user_id, current_admin)
    if user.suspended_at is not None:
        raise HTTPException(status_code=409, detail="Account is already suspended")
    return suspend_user(db, user, admin=current_admin, reason=payload.reason)


@router.post("/admin/users/{user_id}/reinstate", response_model=UserResponse)
def reinstate_account(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(_require_admin),
):
    user = _get_other_user(db, user_id, current_admin)
    if user.suspended_at is None:
        raise HTTPException(status_code=409, detail="Account is not suspended")
    return reinstate_user(db, user, admin=current_admin)


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


WEEKS_SHOWN = 12


def _weekly_signups(db: Session, now: datetime | None = None) -> list[dict]:
    """New buyers and new merchants per Manila week (Monday start), oldest first.

    A buyer is a non-admin account with no merchant profile; a merchant is
    counted in the week its merchant profile was created.
    """
    today = (now or datetime.now(UTC)).astimezone(PH_TZ).date()
    first_week = today - timedelta(days=today.weekday(), weeks=WEEKS_SHOWN - 1)
    since = datetime.combine(first_week, time.min, tzinfo=PH_TZ)
    weeks = {
        first_week + timedelta(weeks=i): {"buyers": 0, "merchants": 0}
        for i in range(WEEKS_SHOWN)
    }

    def week_of(moment: datetime):
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=UTC)
        day = moment.astimezone(PH_TZ).date()
        return day - timedelta(days=day.weekday())

    buyers = (
        db.query(User.created_at)
        .outerjoin(Merchant, Merchant.user_id == User.id)
        .filter(
            User.created_at >= since,
            User.is_admin.is_(False),
            Merchant.id.is_(None),
        )
        .all()
    )
    for (created_at,) in buyers:
        bucket = weeks.get(week_of(created_at))
        if bucket is not None:
            bucket["buyers"] += 1
    merchants = db.query(Merchant.created_at).filter(Merchant.created_at >= since).all()
    for (created_at,) in merchants:
        bucket = weeks.get(week_of(created_at))
        if bucket is not None:
            bucket["merchants"] += 1
    return [{"week_start": str(week), **counts} for week, counts in weeks.items()]


@router.get("/admin/stats")
def get_admin_stats(
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    total_revenue = (
        db.query(func.coalesce(func.sum(Transaction.amount), 0))
        .filter(Transaction.status == TransactionStatus.PAID)
        .scalar()
        or 0
    )
    platform_fees = (
        db.query(func.coalesce(func.sum(Transaction.platform_fee), 0))
        .filter(Transaction.status == TransactionStatus.PAID)
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

    # Work waiting on an admin (A5a). Payouts: requested, approved, or failed and
    # needing a resend; "processing" is waiting on PayMongo, not on an admin.
    payouts_to_send = (
        db.query(func.count(PayoutBatch.id))
        .filter(
            PayoutBatch.status.in_(
                [PayoutStatus.PENDING, PayoutStatus.APPROVED, PayoutStatus.FAILED]
            )
        )
        .scalar()
        or 0
    )
    refunds_pending = (
        db.query(func.count(Transaction.id))
        .filter(Transaction.status == TransactionStatus.REFUND_PENDING)
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
        .filter(Transaction.status == TransactionStatus.PAID, Transaction.paid_at >= since)
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
        "pending_work": {
            "applications": int(pending_applications),
            "payouts_to_send": int(payouts_to_send),
            "refunds_pending": int(refunds_pending),
        },
        "weekly_signups": _weekly_signups(db),
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


def _admin_batch_view(
    batch: PayoutBatch, merchant_name: str | None, info
) -> AdminPayoutBatchResponse:
    destination = None
    if info is not None:
        try:
            dest = resolve_destination(info)
            destination = PayoutDestinationPreview(
                type=dest.type,
                institution=dest.institution,
                name=dest.name,
                number=dest.number,
                provider=dest.provider,
            )
        except PayoutError:
            destination = PayoutDestinationPreview(
                type=info.payout_type,
                institution=info.bank_name,
                name=info.account_name,
                number=info.account_number or info.ewallet_number,
                problem=payout_info_problem(info),
            )
    update = {"merchant_name": merchant_name, "destination": destination}
    if batch.transfer_fee is None:
        # Requested before fees were recorded: preview what sending would take.
        fee = transfer_fee()
        update |= {"transfer_fee": fee, "net_amount": batch.gross_amount - fee}
    return AdminPayoutBatchResponse.model_validate(batch).model_copy(update=update)


def _admin_batch_response(db: Session, batch: PayoutBatch) -> AdminPayoutBatchResponse:
    merchant = db.get(Merchant, batch.merchant_id)
    return _admin_batch_view(
        batch,
        merchant.merchant_name if merchant else None,
        get_payout_info(db, batch.merchant_id),
    )


@router.get("/admin/wallet", response_model=WalletBalance)
def get_wallet_balance(admin: User = Depends(_require_admin)):
    """Balance of the PayMongo wallet merchant payouts are sent from."""
    try:
        balance = paymongo.get_wallet_balance()
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail="Could not read the PayMongo wallet"
        ) from exc
    return WalletBalance(
        available=balance["available"] / 100, pending=balance["pending"] / 100
    )


@router.get("/admin/batches", response_model=list[AdminPayoutBatchResponse])
def list_payout_batches(
    status: PayoutStatus | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    q = (
        db.query(PayoutBatch, Merchant.merchant_name, MerchantPayoutInfo)
        .outerjoin(Merchant, Merchant.id == PayoutBatch.merchant_id)
        .outerjoin(
            MerchantPayoutInfo,
            MerchantPayoutInfo.merchant_id == PayoutBatch.merchant_id,
        )
    )
    if status:
        q = q.filter(PayoutBatch.status == status)
    rows = q.order_by(PayoutBatch.created_at.desc()).all()
    return [_admin_batch_view(batch, name, info) for batch, name, info in rows]


@router.patch(
    "/admin/batches/{batch_id}/release", response_model=AdminPayoutBatchResponse
)
def release_payout_batch(
    batch_id: int,
    notes: str | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Send the batch to the merchant through PayMongo (or resend a failed one).

    Returns the batch as ``processing`` once PayMongo accepts the transfer, or
    ``failed`` with a reason when PayMongo refuses it.
    """
    existing = db.get(PayoutBatch, batch_id)
    before = (
        {"status": existing.status, "attempts": existing.attempts}
        if existing is not None
        else None
    )
    try:
        batch = send_payout(db, batch_id, notes)
    except PayoutError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.refresh(batch)
    # send_payout commits on its own; the log is its own commit afterwards.
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.PAYOUT_RELEASE,
        target_type="payout_batch",
        target_id=batch.id,
        before=before,
        after={
            "status": batch.status,
            "attempts": batch.attempts,
            "net_amount": batch.net_amount,
            "paymongo_reference": batch.paymongo_reference,
            "paymongo_transfer_id": batch.paymongo_transfer_id,
            "failure_reason": batch.failure_reason,
            "notes": notes,
        },
    )
    db.commit()
    return _admin_batch_response(db, batch)


@router.post(
    "/admin/batches/{batch_id}/refresh", response_model=AdminPayoutBatchResponse
)
def refresh_payout_batch(
    batch_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Ask PayMongo for the transfer's current status."""
    try:
        batch = refresh_payout(db, batch_id)
    except PayoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail="Could not reach PayMongo. Try again."
        ) from exc
    return _admin_batch_response(db, batch)


@router.patch(
    "/admin/merchant-applications/{app_id}", response_model=MerchantApplicationResponse
)
def review_merchant_application(
    app_id: int,
    payload: ApplicationReviewPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    application = (
        db.query(MerchantApplication).filter(MerchantApplication.id == app_id).first()
    )
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    before = {
        "status": application.status,
        "admin_note": application.admin_note,
        "merchant_id": application.merchant_id,
    }
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

    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.APPLICATION_REVIEW,
        target_type="merchant_application",
        target_id=application.id,
        before=before,
        after={
            "status": application.status,
            "admin_note": application.admin_note,
            "merchant_id": application.merchant_id,
        },
    )
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

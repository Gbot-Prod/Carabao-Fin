import logging
from datetime import UTC, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Date, cast, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db
from app.core.errors import upstream_error
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.order import Order
from app.models.payout_batch import PayoutBatch
from app.models.produce import Produce
from app.models.statuses import PayoutStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.merchant import AdminMerchantResponse
from app.schemas.merchant_application import (
    AdminMerchantApplicationResponse,
    ApplicationReviewPayload,
)
from app.schemas.pagination import Page
from app.schemas.payout import (
    AdminPayoutBatchResponse,
    PayoutDestinationPreview,
    WalletBalance,
)
from app.schemas.user import UserResponse
from app.services import (
    admin_enrolment,
    audit_log,
    better_auth_store,
    money,
    paymongo,
    r2_service,
)
from app.services.account_suspension import reinstate_user, suspend_user
from app.services.application_review import apply_admin_decision
from app.services.payout_service import (
    PayoutError,
    refresh_payout,
    saved_destination,
    send_payout,
    transfer_fee,
)
from app.services.produce_freshness import PH_TZ

router = APIRouter(tags=["admin"])
logger = logging.getLogger(__name__)


ADMIN_2FA_DETAIL = (
    "Two-step verification is required for admin accounts. Open the setup link "
    "we sent you by SMS or email, or ask another admin for a new one."
)
ADMIN_MFA_SESSION_DETAIL = (
    "Sign in again and enter the code from your authenticator app to use the "
    "admin area."
)
ADMIN_SURFACE_DETAIL = "Use the admin site to do this."



def _require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Admins always need two-step verification (E8c, CF-0003), and this
    session must have passed the TOTP step (CF-0017): a Google sign-in or a
    session from before 2FA was on does not count.

    The token must also come from the admin web deploy: signed by its own keys
    (app/core/security.py). A session on the public site gets nothing here."""
    if current_user.token_surface != "admin":
        raise HTTPException(status_code=403, detail=ADMIN_SURFACE_DETAIL)
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    if not current_user.two_factor_enabled:
        raise HTTPException(status_code=403, detail=ADMIN_2FA_DETAIL)
    if not current_user.mfa_session:
        raise HTTPException(status_code=403, detail=ADMIN_MFA_SESSION_DETAIL)
    return current_user


class RolePayload(BaseModel):
    is_admin: bool

    model_config = ConfigDict(extra="forbid")  # CF-0063


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

    before = {"is_admin": user.is_admin}
    promoted = payload.is_admin and not user.is_admin
    demoted = user.is_admin and not payload.is_admin
    if promoted:
        # CF-0018: the new admin sets up 2FA only with the link sent here.
        admin_enrolment.require_contact(user)
    better_auth_store.set_role(db, user.external_auth_id, is_admin=payload.is_admin)
    token = admin_enrolment.issue(db, user) if promoted else None
    if demoted:
        # 2FA is for admins only; this also ends the old admin sessions.
        better_auth_store.clear_two_factor(db, user.external_auth_id)
    audit_log.record_admin_action(
        db,
        admin=current_admin,
        action=audit_log.ROLE_CHANGE,
        target_type="user",
        target_id=user.id,
        before=before,
        after={"is_admin": payload.is_admin},
    )
    db.commit()
    db.refresh(user)
    if token:
        admin_enrolment.deliver(user, token)
    return user


class TwoFactorResetResponse(BaseModel):
    sent_to: list[str]


@router.post(
    "/admin/users/{user_id}/two-factor/reset", response_model=TwoFactorResetResponse
)
def reset_admin_two_factor(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(_require_admin),
):
    """Another admin's lost authenticator, or a setup link that expired or was
    not received. Sends a new setup link; the older link stops working. If 2FA
    is on, it is turned off and the admin's sessions end first. If it is not
    set up yet, nothing else changes (the admin stays signed in)."""
    if current_admin.id == user_id:
        raise HTTPException(
            status_code=400,
            detail="Ask another admin to reset your two-step verification",
        )
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_admin:
        raise HTTPException(
            status_code=400, detail="Only admin accounts use two-step verification"
        )
    admin_enrolment.require_contact(user)
    before = {"two_factor_enabled": user.two_factor_enabled}
    if user.two_factor_enabled:
        better_auth_store.clear_two_factor(db, user.external_auth_id)
    token = admin_enrolment.issue(db, user)
    audit_log.record_admin_action(
        db,
        admin=current_admin,
        action=audit_log.TWO_FACTOR_RESET,
        target_type="user",
        target_id=user.id,
        before=before,
        after={"two_factor_enabled": False, "setup_link_sent": True},
    )
    db.commit()
    return {"sent_to": admin_enrolment.deliver(user, token)}


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
        q.options(selectinload(User.addresses))
        .order_by(User.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
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
                "owner_is_suspended": bool(m.user and m.user.is_suspended),
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

    model_config = ConfigDict(extra="forbid")  # CF-0063


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
    if user.is_suspended:
        raise HTTPException(status_code=409, detail="Account is already suspended")
    return suspend_user(db, user, admin=current_admin, reason=payload.reason)


@router.post("/admin/users/{user_id}/reinstate", response_model=UserResponse)
def reinstate_account(
    user_id: int,
    db: Session = Depends(get_db),
    current_admin: User = Depends(_require_admin),
):
    user = _get_other_user(db, user_id, current_admin)
    if not user.is_suspended:
        raise HTTPException(status_code=409, detail="Account is not suspended")
    return reinstate_user(db, user, admin=current_admin)


@router.get(
    "/admin/merchant-applications",
    response_model=list[AdminMerchantApplicationResponse],
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
            ~User.is_admin,
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


UNCATEGORIZED = "Uncategorized"


def _item_int(item: dict, *keys: str) -> int | None:
    for key in keys:
        try:
            return int(item[key])
        except (KeyError, TypeError, ValueError):
            continue
    return None


def _top_categories(
    db: Session, since: datetime, limit: int = 8
) -> tuple[list[dict], int]:
    """Item revenue and quantity by produce category, from orders paid since ``since``.

    Item revenue is unit price x quantity (delivery fee excluded). Categories come
    from the produce row as it is now; deleted produce counts as Uncategorized.

    Returns the ranked rows and the number of orders skipped. An order with a
    bad snapshot price is logged and skipped as a whole, so one bad row does
    not make the dashboard fail (CF-0027) and is never counted as 0 (CF-0014).
    """
    paid_orders = (
        db.query(Order.id, Order.items)
        .filter(
            Order.id.in_(
                db.query(Transaction.order_id).filter(
                    Transaction.status == TransactionStatus.PAID,
                    Transaction.paid_at >= since,
                )
            )
        )
        .all()
    )
    lines = []
    skipped_rows = 0
    for order_id, items in paid_orders:
        order_lines = []
        try:
            for item in items or []:
                if not isinstance(item, dict):
                    continue
                quantity = _item_int(item, "quantity") or 0
                price = money.whole_pesos(item.get("price"))
                if quantity <= 0:
                    continue
                order_lines.append(
                    (_item_int(item, "produce_id", "produceId", "id"), quantity, price)
                )
        except money.InvalidAmount as exc:
            logger.warning(
                "Top categories: skipped order %s with a bad item price: %s",
                order_id,
                exc,
            )
            skipped_rows += 1
            continue
        lines.extend(order_lines)

    produce_ids = {pid for pid, _, _ in lines if pid is not None}
    categories = dict(
        db.query(Produce.id, Produce.category).filter(Produce.id.in_(produce_ids)).all()
        if produce_ids
        else []
    )
    totals: dict[str, dict[str, int]] = {}
    for pid, quantity, price in lines:
        name = (categories.get(pid) or "").strip() or UNCATEGORIZED
        bucket = totals.setdefault(name, {"revenue": 0, "quantity": 0})
        bucket["revenue"] += price * quantity
        bucket["quantity"] += quantity
    ranked = sorted(totals.items(), key=lambda kv: (-kv[1]["revenue"], kv[0]))
    rows = [{"category": name, **values} for name, values in ranked[:limit]]
    return rows, skipped_rows


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
        .filter(
            Transaction.status == TransactionStatus.PAID, Transaction.paid_at >= since
        )
        .group_by(paid_day)
        .order_by(paid_day)
        .all()
    )

    order_rows = (
        db.query(Order.status, func.count(Order.id).label("count"))
        .group_by(Order.status)
        .all()
    )

    top_categories, top_categories_skipped = _top_categories(db, since)

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
        "top_categories": top_categories,
        "top_categories_skipped_rows": top_categories_skipped,
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
    batch: PayoutBatch, merchant_name: str | None
) -> AdminPayoutBatchResponse:
    # CF-0004: where sending will go is the destination saved on the batch.
    dest = saved_destination(batch)
    destination = (
        PayoutDestinationPreview(
            type=dest.type,
            institution=dest.institution,
            name=dest.name,
            number=dest.number,
            provider=dest.provider,
        )
        if dest is not None
        else PayoutDestinationPreview(
            type="unknown",
            problem="No saved destination; the merchant must request it again.",
        )
    )
    update = {"merchant_name": merchant_name, "destination": destination}
    if batch.transfer_fee is None:
        # Requested before fees were recorded: preview what sending would take.
        fee = transfer_fee()
        update |= {"transfer_fee": fee, "net_amount": batch.gross_amount - fee}
    return AdminPayoutBatchResponse.model_validate(batch).model_copy(update=update)


def _admin_batch_response(db: Session, batch: PayoutBatch) -> AdminPayoutBatchResponse:
    merchant = db.get(Merchant, batch.merchant_id)
    return _admin_batch_view(batch, merchant.merchant_name if merchant else None)


@router.get("/admin/wallet", response_model=WalletBalance)
def get_wallet_balance(admin: User = Depends(_require_admin)):
    """Balance of the PayMongo wallet merchant payouts are sent from."""
    try:
        balance = paymongo.get_wallet_balance()
    except Exception as exc:
        raise upstream_error(
            502,
            "Could not read the PayMongo wallet",
            log="PayMongo wallet balance failed",
            exc=exc,
        ) from exc
    return WalletBalance(
        available=float(money.from_centavos(balance["available"])),
        pending=float(money.from_centavos(balance["pending"])),
    )


@router.get("/admin/batches", response_model=list[AdminPayoutBatchResponse])
def list_payout_batches(
    status: PayoutStatus | None = None,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    q = (
        db.query(PayoutBatch, Merchant.merchant_name)
        .outerjoin(Merchant, Merchant.id == PayoutBatch.merchant_id)
    )
    if status:
        q = q.filter(PayoutBatch.status == status)
    rows = q.order_by(PayoutBatch.created_at.desc()).all()
    return [_admin_batch_view(batch, name) for batch, name in rows]


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
    # CF-0054 (B53): a refresh can move a batch to released or failed (which
    # frees its orders for another payout), so a change is audited.
    before_status: str | None = (
        db.query(PayoutBatch.status).filter(PayoutBatch.id == batch_id).scalar()
    )
    before_reason: str | None = (
        db.query(PayoutBatch.failure_reason)
        .filter(PayoutBatch.id == batch_id)
        .scalar()
    )
    try:
        batch = refresh_payout(db, batch_id)
    except PayoutError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except Exception as exc:
        raise upstream_error(
            502,
            "Could not reach PayMongo. Try again.",
            log=f"PayMongo payout refresh failed for batch {batch_id}",
            exc=exc,
        ) from exc
    if before_status is not None and before_status != batch.status:
        audit_log.record_admin_action(
            db,
            admin=admin,
            action=audit_log.PAYOUT_REFRESH,
            target_type="payout_batch",
            target_id=batch_id,
            before={"status": before_status, "failure_reason": before_reason},
            after={"status": batch.status, "failure_reason": batch.failure_reason},
        )
        db.commit()
    return _admin_batch_response(db, batch)


@router.patch(
    "/admin/merchant-applications/{app_id}",
    response_model=AdminMerchantApplicationResponse,
)
def review_merchant_application(
    app_id: int,
    payload: ApplicationReviewPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    application = (
        db.query(MerchantApplication)
        .filter(MerchantApplication.id == app_id)
        # Two admins deciding at once must not both pass the transition check.
        .with_for_update()
        .first()
    )
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    before = {
        "status": application.status,
        "admin_note": application.admin_note,
        "merchant_id": application.merchant_id,
    }
    try:
        apply_admin_decision(db, application, payload.status)
    except (ValueError, IntegrityError) as exc:
        db.rollback()
        raise HTTPException(
            status_code=400, detail="Failed to create merchant profile"
        ) from exc
    application.admin_note = payload.admin_note or None
    now = datetime.now(UTC)
    application.reviewed_by_user_id = admin.id
    application.reviewed_at = now
    if payload.status == "approved" and application.merchant_id is not None:
        merchant = db.get(Merchant, application.merchant_id)
        if merchant is not None:
            merchant.verified_by_user_id = admin.id
            merchant.verified_at = now

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


def _document_url_response(
    db: Session, app_id: int, document: str, label: str
) -> dict:
    """A short-lived signed URL for one of an application's private documents."""
    application = (
        db.query(MerchantApplication).filter(MerchantApplication.id == app_id).first()
    )
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")

    path = getattr(application, f"{document}_document_path")
    content_type = getattr(application, f"{document}_document_content_type")
    if not path:
        raise HTTPException(status_code=404, detail=f"{label} not found")

    try:
        url = r2_service.create_private_document_url(path, content_type)
    except Exception as exc:
        raise upstream_error(
            502,
            f"Unable to prepare {label}",
            log=f"R2 {label} signed URL failed",
            exc=exc,
        ) from exc
    if not url:
        raise HTTPException(status_code=502, detail=f"Unable to prepare {label}")

    return {
        "url": url,
        "filename": getattr(application, f"{document}_document_original_name"),
        "content_type": content_type,
    }


@router.get("/admin/merchant-applications/{app_id}/rsbsa-document")
def get_rsbsa_document_url(
    app_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    return _document_url_response(db, app_id, "rsbsa", "RSBSA document")


@router.get("/admin/merchant-applications/{app_id}/gov-id-document")
def get_gov_id_document_url(
    app_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    return _document_url_response(db, app_id, "gov_id", "government ID")

"""Admin view of every order (A1) and the refund queue (A2)."""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import String, and_, cast, exists, not_
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.models.order import Order
from app.models.order_proof_photo import PROOF_KINDS, OrderProofPhoto
from app.models.statuses import OrderStatus, PaymentStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.admin_order import (
    AdminOrderDelivery,
    AdminOrderDetail,
    AdminOrderShipment,
    AdminOrderSummary,
    AdminOrderTransaction,
    AdminProofPhoto,
    AdminRefund,
    CancelOrderPayload,
    DisputeDecisionPayload,
    RecordRefundPayload,
)
from app.schemas.pagination import MAX_ID, MAX_PAGE, Page
from app.services import audit_log, delivery_dispute, order_proof, rate_limit
from app.services.order_status import (
    ACTIVE_ORDER_STATUSES,
    PaymentInProgress,
    cancel_paid_order,
    payment_status,
)
from app.services.produce_freshness import ph_day_start
from app.services.refund_service import RefundError, record_refund

router = APIRouter(tags=["admin"])


def _has_txn(status: TransactionStatus):
    return exists().where(
        Transaction.order_id == Order.id, Transaction.status == status
    )


def _payment_status_clause(wanted: PaymentStatus):
    """SQL mirror of ``order_status.payment_status`` (same precedence)."""
    paid = _has_txn(TransactionStatus.PAID)
    refund_pending = _has_txn(TransactionStatus.REFUND_PENDING)
    refunded = _has_txn(TransactionStatus.REFUNDED)
    if wanted == PaymentStatus.PAID:
        return paid
    if wanted == PaymentStatus.REFUND_PENDING:
        return and_(not_(paid), refund_pending)
    if wanted == PaymentStatus.REFUNDED:
        return and_(not_(paid), not_(refund_pending), refunded)
    none_landed = and_(not_(paid), not_(refund_pending), not_(refunded))
    if wanted == PaymentStatus.AWAITING_PAYMENT:
        return and_(none_landed, Order.status == OrderStatus.PENDING)
    return and_(none_landed, Order.status != OrderStatus.PENDING)


# A drop-off or failed drop-off photo with at least one flag. ``flags`` is a
# JSON list, stored as "[]" when empty (SQLite and Postgres alike).
_FLAGGED_PHOTO = exists().where(
    OrderProofPhoto.order_id == Order.id,
    OrderProofPhoto.kind.in_((order_proof.DROPOFF, order_proof.ATTEMPT)),
    cast(OrderProofPhoto.flags, String) != "[]",
)
_DISPUTE_OPEN = and_(
    Order.delivery_disputed_at.isnot(None), Order.dispute_resolution.is_(None)
)


def _flagged_ids(db: Session, order_ids: list[int]) -> set[int]:
    if not order_ids:
        return set()
    rows = db.query(OrderProofPhoto.order_id, OrderProofPhoto.flags).filter(
        OrderProofPhoto.order_id.in_(order_ids),
        OrderProofPhoto.kind.in_((order_proof.DROPOFF, order_proof.ATTEMPT)),
    )
    return {order_id for order_id, flags in rows if flags}


def _buyer_name(user: User | None) -> str | None:
    return (user.name or None) if user is not None else None


def _summary_fields(order: Order, flagged: bool = False) -> dict:
    return {
        "id": order.id,
        "status": order.status,
        "payment_status": payment_status(order),
        "total_price": order.total_price,
        "delivery_fee": order.delivery_fee or 0,
        "discount": order.discount or 0,
        "voucher_code": order.voucher_code,
        "ordered_at": order.ordered_at,
        "merchant_id": order.merchant_id,
        "merchant_name": order.merchant.merchant_name if order.merchant else None,
        "buyer_id": order.user_id,
        "buyer_name": _buyer_name(order.user),
        "buyer_email": order.user.email if order.user else None,
        "shipment_id": order.shipment_id,
        "delivery_flagged": flagged,
        "dispute_open": delivery_dispute.is_open(order),
    }


@router.get("/admin/orders", response_model=Page[AdminOrderSummary])
def list_all_orders(
    status: OrderStatus | None = None,
    merchant_id: int | None = Query(None, ge=1, le=MAX_ID),
    payment: PaymentStatus | None = Query(None, alias="payment_status"),
    date_from: date | None = None,
    date_to: date | None = None,
    # ORDER_PROOF_PHOTOS_PLAN.md: "flagged" (a drop-off or failed drop-off
    # photo has a flag) or "disputed" (the buyer disputes it; no decision yet).
    delivery: Literal["flagged", "disputed"] | None = None,
    page: int = Query(1, ge=1, le=MAX_PAGE),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    q = db.query(Order)
    if status is not None:
        q = q.filter(Order.status == status)
    if merchant_id is not None:
        q = q.filter(Order.merchant_id == merchant_id)
    if payment is not None:
        q = q.filter(_payment_status_clause(payment))
    # Days are Manila calendar days (CF-0039); date_to includes the whole day.
    if date_from is not None:
        q = q.filter(Order.ordered_at >= ph_day_start(date_from))
    if date_to is not None:
        q = q.filter(Order.ordered_at < ph_day_start(date_to + timedelta(days=1)))
    if delivery == "flagged":
        q = q.filter(_FLAGGED_PHOTO)
    elif delivery == "disputed":
        q = q.filter(_DISPUTE_OPEN)

    total = q.count()
    orders = (
        q.options(
            joinedload(Order.merchant),
            joinedload(Order.user),
            joinedload(Order.transactions),
        )
        .order_by(Order.ordered_at.desc(), Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    flagged = _flagged_ids(db, [o.id for o in orders])
    items = [AdminOrderSummary(**_summary_fields(o, o.id in flagged)) for o in orders]
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/admin/orders/{order_id}", response_model=AdminOrderDetail)
def get_order_detail(
    order_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return _detail_view(db, order)


@router.get("/admin/orders/{order_id}/proof/{kind}")
def get_order_proof_photo(
    order_id: int,
    kind: str,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """A proof photo of any order (image bytes)."""
    if kind not in PROOF_KINDS:
        raise HTTPException(status_code=404, detail="Photo not found")
    rate_limit.enforce_action(db, "proof_view", str(admin.id))
    row = order_proof.get_photo(db, order_id, kind)
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(
        content=order_proof.read_photo(row),
        media_type=row.content_type,
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/admin/orders/{order_id}/dispute", response_model=AdminOrderDetail)
def decide_delivery_dispute(
    order_id: int,
    payload: DisputeDecisionPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """Decide a disputed merchant-set delivery: ``release`` pays the merchant,
    ``refund`` moves the paid money to the refund queue (/admin/refunds)."""
    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    note = (payload.note or "").strip() or None
    try:
        delivery_dispute.resolve_dispute(db, order, admin, payload.decision, note)
    except delivery_dispute.DisputeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    db.refresh(order)
    return _detail_view(db, order)


@router.post("/admin/orders/{order_id}/cancel", response_model=AdminOrderDetail)
def cancel_order_as_admin(
    order_id: int,
    payload: CancelOrderPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    """CF-0045: cancel an order the farm cannot complete, so the buyer is refunded.

    A paid order's money moves to refund_pending, where /admin/refunds lists it.
    """
    order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in ACTIVE_ORDER_STATUSES:
        raise HTTPException(
            status_code=409, detail=f"Cannot cancel an order that is {order.status}"
        )
    before = {"status": order.status}
    try:
        cancel_paid_order(order, db, payload.reason.strip())
    except PaymentInProgress as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.ORDER_CANCEL,
        target_type="order",
        target_id=order.id,
        before=before,
        after={"status": order.status, "reason": payload.reason.strip()},
    )
    db.commit()
    db.refresh(order)
    return _detail_view(db, order)


def _proof_photos(db: Session, order_id: int) -> list[AdminProofPhoto]:
    rows = (
        db.query(OrderProofPhoto)
        .filter(OrderProofPhoto.order_id == order_id)
        .order_by(OrderProofPhoto.received_at, OrderProofPhoto.id)
        .all()
    )
    return [
        AdminProofPhoto(
            kind=row.kind,
            received_at=row.received_at,
            distance_m=row.distance_m,
            flags=list(row.flags or []),
            deleted=row.object_key is None,
        )
        for row in rows
    ]


def _detail_view(db: Session, order: Order) -> AdminOrderDetail:
    shipment = order.shipment
    photos = _proof_photos(db, order.id)
    flagged = any(p.flags for p in photos if p.kind != order_proof.PACKING)
    return AdminOrderDetail(
        **_summary_fields(order, flagged),
        proof_photos=photos,
        items=[i for i in (order.items or []) if isinstance(i, dict)],
        notes=order.notes,
        transactions=[
            AdminOrderTransaction(
                id=t.id,
                status=t.status,
                amount=t.amount,
                platform_fee=t.platform_fee,
                merchant_amount=t.merchant_amount,
                paymongo_payment_id=t.paymongo_payment_id,
                created_at=t.created_at,
                paid_at=t.paid_at,
                refund_method=t.refund_method,
                refund_reference=t.refund_reference,
                refunded_at=t.refunded_at,
            )
            for t in order.transactions
        ],
        shipment=(
            AdminOrderShipment(
                id=shipment.id,
                status=shipment.status,
                stop_count=shipment.stop_count,
                shipped_at=shipment.shipped_at,
            )
            if shipment
            else None
        ),
        delivery=AdminOrderDelivery(
            delivery_address=order.delivery_address,
            requested_delivery_date=order.requested_delivery_date,
            delivery_window=order.delivery_window,
            time_of_arrival=order.time_of_arrival,
            shipped_at=order.shipped_at,
            delivered_at=order.delivered_at,
            delivery_confirmed_by=order.delivery_confirmed_by,
            cancel_reason=order.cancel_reason,
            delivery_buyer_confirmed_at=order.delivery_buyer_confirmed_at,
            dispute_until=delivery_dispute.dispute_until(order),
            delivery_disputed_at=order.delivery_disputed_at,
            dispute_resolution=order.dispute_resolution,
            dispute_resolved_at=order.dispute_resolved_at,
        ),
    )


def _refund_view(txn: Transaction) -> AdminRefund:
    order = txn.order
    return AdminRefund(
        transaction_id=txn.id,
        order_id=txn.order_id,
        order_status=order.status if order else "",
        status=txn.status,
        amount=txn.amount,
        paymongo_payment_id=txn.paymongo_payment_id,
        paid_at=txn.paid_at,
        buyer_name=_buyer_name(txn.user),
        buyer_email=txn.user.email if txn.user else None,
        buyer_phone=txn.user.phone_number if txn.user else None,
        merchant_name=txn.merchant.merchant_name if txn.merchant else None,
        refund_method=txn.refund_method,
        refund_reference=txn.refund_reference,
        refund_notes=txn.refund_notes,
        refunded_at=txn.refunded_at,
    )


@router.get("/admin/refunds", response_model=list[AdminRefund])
def list_refunds(
    status: TransactionStatus = TransactionStatus.REFUND_PENDING,
    db: Session = Depends(get_db),
    _: User = Depends(_require_admin),
):
    if status not in (TransactionStatus.REFUND_PENDING, TransactionStatus.REFUNDED):
        raise HTTPException(
            status_code=422, detail="status must be refund_pending or refunded"
        )
    order_by = (
        Transaction.refunded_at.desc()
        if status == TransactionStatus.REFUNDED
        else Transaction.created_at.asc()
    )
    txns = (
        db.query(Transaction)
        .options(
            joinedload(Transaction.order),
            joinedload(Transaction.user),
            joinedload(Transaction.merchant),
        )
        .filter(Transaction.status == status)
        .order_by(order_by, Transaction.id.asc())
        .all()
    )
    return [_refund_view(t) for t in txns]


@router.post("/admin/refunds/{transaction_id}", response_model=AdminRefund)
def record_transaction_refund(
    transaction_id: int,
    payload: RecordRefundPayload,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    try:
        txn = record_refund(
            db,
            transaction_id=transaction_id,
            admin=admin,
            method=payload.method,
            reference=payload.reference,
            notes=payload.notes,
        )
    except RefundError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return _refund_view(txn)

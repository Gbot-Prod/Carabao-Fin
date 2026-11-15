"""Admin view of every order (A1) and the refund queue (A2)."""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, exists, not_
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_db
from app.api.routes.admin import _require_admin
from app.models.order import Order
from app.models.statuses import OrderStatus, PaymentStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.admin_order import (
    AdminOrderDelivery,
    AdminOrderDetail,
    AdminOrderShipment,
    AdminOrderSummary,
    AdminOrderTransaction,
    AdminRefund,
    RecordRefundPayload,
)
from app.schemas.pagination import Page
from app.services.order_status import payment_status
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


def _buyer_name(user: User | None) -> str | None:
    return (user.name or None) if user is not None else None


def _summary_fields(order: Order) -> dict:
    return {
        "id": order.id,
        "status": order.status,
        "payment_status": payment_status(order),
        "total_price": order.total_price,
        "delivery_fee": order.delivery_fee or 0,
        "ordered_at": order.ordered_at,
        "merchant_id": order.merchant_id,
        "merchant_name": order.merchant.merchant_name if order.merchant else None,
        "buyer_id": order.user_id,
        "buyer_name": _buyer_name(order.user),
        "buyer_email": order.user.email if order.user else None,
        "shipment_id": order.shipment_id,
    }


@router.get("/admin/orders", response_model=Page[AdminOrderSummary])
def list_all_orders(
    status: OrderStatus | None = None,
    merchant_id: int | None = None,
    payment: PaymentStatus | None = Query(None, alias="payment_status"),
    date_from: date | None = None,
    date_to: date | None = None,
    page: int = Query(1, ge=1),
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
    if date_from is not None:
        q = q.filter(Order.ordered_at >= datetime.combine(date_from, time.min))
    if date_to is not None:
        # Inclusive of the whole end day.
        end = datetime.combine(date_to + timedelta(days=1), time.min)
        q = q.filter(Order.ordered_at < end)

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
    items = [AdminOrderSummary(**_summary_fields(o)) for o in orders]
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

    shipment = order.shipment
    return AdminOrderDetail(
        **_summary_fields(order),
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

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.current_orders import CurrentOrder
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.produce import Produce
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.order import (
    CurrentOrderResponse,
    OrderItemResponse,
    PlaceOrderRequest,
    PlaceOrderResponse,
)
from app.services.merchant_service import get_active_merchant
from app.services.order_reservations import (
    cancel_order,
    expire_stale_reservations,
    reservation_ttl_minutes,
)
from app.services.order_status import (
    IN_TRANSIT_STATUSES,
    MERCHANT_TRANSITIONS,
    mark_delivered,
    mark_shipped,
)
from app.services.sms_service import notify_order_shipped

from ._order_helpers import (
    _extract_item_int,
    _to_int,
    get_or_create_cart,
    get_or_create_order_history,
    get_order_history,
    to_current_order_item,
    to_current_order_item_from_order,
    to_order_history_item,
)

router = APIRouter(tags=["orders"])

@router.post("/orders/me/place", response_model=PlaceOrderResponse)
async def place_order_from_cart(
    payload: PlaceOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Release any elapsed checkout holds before checking availability.
    expire_stale_reservations(db, reservation_ttl_minutes())
    cart = get_or_create_cart(db, current_user.id)
    cart_items = cart.items or []
    if not cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    history = get_or_create_order_history(db, current_user.id)
    produce_by_id: dict[int, Produce] = {}
    order_items = []
    fresh_total = 0
    for item in cart_items:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Invalid cart item")

        produce_id = _extract_item_int(item, "produce_id", "produceId", "id")
        if produce_id is None:
            raise HTTPException(status_code=400, detail="Cart item is missing a produce ID")

        produce = (
            db.query(Produce)
            .filter(Produce.id == produce_id)
            .with_for_update()
            .first()
        )
        if produce is None:
            raise HTTPException(
                status_code=400, detail=f"Produce ID {produce_id} not found"
            )

        quantity = max(_to_int(item.get("quantity"), 0), 0)
        if quantity == 0:
            raise HTTPException(status_code=400, detail="Item quantity must be positive")
        if produce.stock_quantity < quantity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient stock for '{produce.name}': "
                    f"{produce.stock_quantity} available, {quantity} requested"
                ),
            )

        produce_by_id[produce_id] = produce
        produce.stock_quantity -= quantity
        fresh_total += produce.price * quantity
        order_items.append({**item, "price": produce.price})

    merchant_ids = {produce.merchant_id for produce in produce_by_id.values()}
    if len(merchant_ids) != 1:
        raise HTTPException(
            status_code=400,
            detail="Your cart can contain products from only one merchant.",
        )

    # Shared lock: checkouts don't block each other, but a concurrent merchant
    # deletion either waits for this order or is seen here as deleted.
    merchant = (
        db.query(Merchant)
        .filter(Merchant.id == next(iter(merchant_ids)))
        .with_for_update(read=True)
        .populate_existing()
        .first()
    )
    if merchant is None or merchant.deleted_at is not None:
        raise HTTPException(
            status_code=400, detail="This merchant is no longer accepting orders"
        )
    service_fee = merchant.delivery_price or 0
    total_price = fresh_total + service_fee

    order = Order(
        order_history_id=history.id,
        user_id=current_user.id,
        merchant_id=merchant.id if merchant is not None else None,
        status="pending",
        total_price=total_price,
        items=order_items,
        delivery_address=payload.delivery_address,
    )
    db.add(order)
    db.flush()

    current_order = CurrentOrder(
        order_id=order.id,
        merchant_id=merchant.id if merchant is not None else None,
        status="pending",
        delivery_fee=service_fee,
        image=payload.image,
    )
    db.add(current_order)

    db.commit()
    db.refresh(order)

    ordered_year = order.ordered_at.year if order.ordered_at else 0
    order_reference = f"CB-{ordered_year}-{order.id:04d}"

    return PlaceOrderResponse(
        order_id=order.id,
        order_reference=order_reference,
        status=order.status,
    )


@router.get("/orders/me/history", response_model=list[OrderItemResponse])
async def get_my_order_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    history = get_order_history(db, current_user.id)
    if history is None:
        return []

    orders = sorted(
        history.orders, key=lambda order: order.ordered_at or datetime.min, reverse=True
    )
    return [to_order_history_item(order) for order in orders]


_REMOVABLE_ORDER_STATUSES = {"delivered", "cancelled"}


@router.delete("/orders/me/history/{order_id}", status_code=204)
async def delete_order_from_history(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    history = get_order_history(db, current_user.id)
    if history is None:
        raise HTTPException(status_code=404, detail="Order not found")

    order = (
        db.query(Order)
        .filter(Order.id == order_id, Order.order_history_id == history.id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in _REMOVABLE_ORDER_STATUSES:
        raise HTTPException(
            status_code=400, detail="Only completed orders can be removed"
        )
    # Stopgap until history uses a hide flag: transactions.order_id is a
    # non-nullable FK, and payment records must outlive the buyer's view.
    has_payment = (
        db.query(Transaction.id).filter(Transaction.order_id == order.id).first()
    )
    if has_payment:
        raise HTTPException(
            status_code=409,
            detail="Orders with a payment record can't be removed yet",
        )

    db.delete(order)
    db.commit()


@router.get("/orders/me/current", response_model=list[CurrentOrderResponse])
async def get_my_current_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_orders = (
        db.query(CurrentOrder)
        .join(Order)
        .join(OrderHistory)
        .filter(OrderHistory.user_id == current_user.id)
        .order_by(CurrentOrder.id.asc())
        .all()
    )

    if current_orders:
        return [
            to_current_order_item(current_order) for current_order in current_orders
        ]

    history = get_order_history(db, current_user.id)
    if history is None:
        return []

    active_statuses = {"pending", "processing", "shipped", "out_for_delivery"}
    active_orders = [
        order
        for order in sorted(
            history.orders, key=lambda item: item.ordered_at, reverse=True
        )
        if order.status.lower() in active_statuses
    ]
    return [to_current_order_item_from_order(order) for order in active_orders]


@router.post(
    "/orders/me/{order_id}/confirm-received", response_model=CurrentOrderResponse
)
async def confirm_order_received(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Buyer confirms delivery, which makes the order's earnings payable."""
    order = (
        db.query(Order)
        .join(OrderHistory, OrderHistory.id == Order.order_history_id)
        .filter(Order.id == order_id, OrderHistory.user_id == current_user.id)
        .with_for_update(of=Order)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in IN_TRANSIT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot confirm an order that is '{order.status}'",
        )

    mark_delivered(order, confirmed_by="buyer")
    db.commit()
    db.refresh(order)
    return to_current_order_item_from_order(order)


# ---------------------------------------------------------------------------
# Merchant order queue routes
# ---------------------------------------------------------------------------

ACTIVE_ORDER_STATUSES = {"pending", "processing", "shipped", "out_for_delivery"}
VALID_ORDER_STATUSES = {
    "pending",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered",
    "cancelled",
}


class OrderStatusUpdate(BaseModel):
    status: str


@router.get("/orders/merchant/current", response_model=list[CurrentOrderResponse])
async def get_merchant_current_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    current_orders = (
        db.query(CurrentOrder)
        .join(Order, CurrentOrder.order_id == Order.id)
        .join(Transaction, Transaction.order_id == Order.id)
        .filter(
            CurrentOrder.merchant_id == merchant.id,
            CurrentOrder.status.in_(ACTIVE_ORDER_STATUSES),
            Transaction.status == "paid",
        )
        .order_by(CurrentOrder.created_at.asc())
        .all()
    )
    return [to_current_order_item(co) for co in current_orders]


@router.patch("/orders/{order_id}/status")
async def update_order_status(
    order_id: int,
    body: OrderStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    status = body.status
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(
            status_code=403, detail="Only merchants can update order status"
        )

    if status not in VALID_ORDER_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {
                ', '.join(sorted(VALID_ORDER_STATUSES))
            }",
        )

    order = (
        db.query(Order)
        .filter(Order.id == order_id, Order.merchant_id == merchant.id)
        .with_for_update()
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    allowed_next = MERCHANT_TRANSITIONS.get(order.status, set())
    if status not in allowed_next:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition order from '{order.status}' to '{status}'",
        )

    if status == "cancelled":
        if not cancel_order(order, db):
            raise HTTPException(
                status_code=409,
                detail="A payment for this order is in progress; try again shortly",
            )
    elif status == "shipped":
        mark_shipped(order)
    else:
        order.status = status
        if order.current_order:
            order.current_order.status = status

    db.commit()

    order_history = (
        db.query(OrderHistory).filter(OrderHistory.id == order.order_history_id).first()
    )
    buyer = (
        db.query(User).filter(User.id == order_history.user_id).first()
        if order_history
        else None
    )
    merchant_name = order.merchant.merchant_name if order.merchant else "Merchant"
    notify_order_shipped(
        phone_number=buyer.phone_number if buyer else None,
        merchant_name=merchant_name,
        order_ref=f"CB-{order.ordered_at.year if order.ordered_at else 'XXXX'}-{order.id:04d}",
        status=status,
    )

    return {"order_id": order_id, "status": status}

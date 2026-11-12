from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.produce import Produce
from app.models.review import Review
from app.models.statuses import OrderStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.order import (
    CurrentOrderResponse,
    OrderDetailResponse,
    OrderItemResponse,
    PlaceOrderRequest,
    PlaceOrderResponse,
)
from app.services.merchant_service import get_active_merchant
from app.services.order_reservations import (
    expire_stale_reservations,
    reservation_ttl_minutes,
)
from app.services.order_status import (
    ACTIVE_ORDER_STATUSES,
    CLOSED_ORDER_STATUSES,
    IN_TRANSIT_STATUSES,
    mark_delivered,
    money_received_clause,
)
from app.services.produce_freshness import is_expired, ph_today
from app.services.review_service import (
    can_review,
    review_deadline,
    to_review_response,
)

from ._order_helpers import (
    _extract_item_int,
    _to_int,
    get_history_orders,
    get_or_create_cart,
    get_or_create_order_history,
    get_order_history,
    order_item_load,
    to_current_order_item,
    to_order_history_item,
)

router = APIRouter(tags=["orders"])

# Buyers pick delivery dates on the Philippine calendar (UTC+8, no DST).
_PH_TZ = timezone(timedelta(hours=8))

@router.post("/orders/me/place", response_model=PlaceOrderResponse)
def place_order_from_cart(
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
    if payload.delivery_date is not None and payload.delivery_date < datetime.now(_PH_TZ).date():
        raise HTTPException(
            status_code=400, detail="Delivery date cannot be in the past"
        )

    today = ph_today()
    history = get_or_create_order_history(db, current_user.id)
    # Lock stock rows in id order so two carts sharing items can't deadlock.
    locked_produce = {
        produce.id: produce
        for produce in db.query(Produce)
        .filter(
            Produce.id.in_(
                {
                    _extract_item_int(item, "produce_id", "produceId", "id")
                    for item in cart_items
                    if isinstance(item, dict)
                }
                - {None}
            )
        )
        .order_by(Produce.id)
        .with_for_update()
        .populate_existing()
        .all()
    }
    produce_by_id: dict[int, Produce] = {}
    order_items = []
    fresh_total = 0
    for item in cart_items:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Invalid cart item")

        produce_id = _extract_item_int(item, "produce_id", "produceId", "id")
        if produce_id is None:
            raise HTTPException(status_code=400, detail="Cart item is missing a produce ID")

        produce = locked_produce.get(produce_id)
        if produce is None:
            raise HTTPException(
                status_code=400, detail=f"Produce ID {produce_id} not found"
            )
        if is_expired(produce, today):
            raise HTTPException(
                status_code=400,
                detail=f"'{produce.name}' is past its best-before date",
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
        status=OrderStatus.PENDING,
        total_price=total_price,
        items=order_items,
        delivery_address=payload.delivery_address,
        requested_delivery_date=payload.delivery_date,
        delivery_window=(payload.delivery_time or "").strip() or None,
        notes=(payload.notes or "").strip() or None,
        delivery_fee=service_fee,
        image=payload.image,
    )
    db.add(order)

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
def get_my_order_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    history = get_order_history(db, current_user.id)
    if history is None:
        return []

    orders = sorted(
        get_history_orders(db, history),
        key=lambda order: order.ordered_at or datetime.min,
        reverse=True,
    )
    return [to_order_history_item(order) for order in orders]


@router.delete("/orders/me/history/{order_id}", status_code=204)
def delete_order_from_history(
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
    if order.status not in CLOSED_ORDER_STATUSES:
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
def get_my_current_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    orders = (
        db.query(Order)
        .options(*order_item_load())
        .join(OrderHistory, OrderHistory.id == Order.order_history_id)
        .filter(
            OrderHistory.user_id == current_user.id,
            Order.status.in_(ACTIVE_ORDER_STATUSES),
        )
        .order_by(Order.id.asc())
        .all()
    )
    return [to_current_order_item(order) for order in orders]


@router.get("/orders/me/{order_id}", response_model=OrderDetailResponse)
def get_my_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One of the buyer's orders, with its review if they left one."""
    order = (
        db.query(Order)
        .options(*order_item_load())
        .join(OrderHistory, OrderHistory.id == Order.order_history_id)
        .filter(Order.id == order_id, OrderHistory.user_id == current_user.id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    item = to_current_order_item(order)
    review = (
        db.query(Review)
        .options(selectinload(Review.user))
        .filter(Review.order_id == order.id)
        .first()
    )
    return OrderDetailResponse(
        **{**item, "id": order.id, "status": order.status},
        delivered_at=order.delivered_at,
        delivery_confirmed_by=order.delivery_confirmed_by,
        review=to_review_response(review, order) if review else None,
        can_review=review is None and can_review(order),
        review_deadline=review_deadline(order),
    )


@router.post(
    "/orders/me/{order_id}/confirm-received", response_model=CurrentOrderResponse
)
def confirm_order_received(
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
    return to_current_order_item(order)


# ---------------------------------------------------------------------------
# Merchant order queue routes
# ---------------------------------------------------------------------------

@router.get("/orders/merchant/current", response_model=list[CurrentOrderResponse])
def get_merchant_current_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    orders = (
        db.query(Order)
        .options(*order_item_load())
        .filter(
            Order.merchant_id == merchant.id,
            Order.status.in_(ACTIVE_ORDER_STATUSES - {OrderStatus.PENDING}),
            money_received_clause(),
        )
        .order_by(Order.ordered_at.asc())
        .all()
    )
    return [to_current_order_item(order) for order in orders]

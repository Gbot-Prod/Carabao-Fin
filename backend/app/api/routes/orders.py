from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.current_orders import CurrentOrder
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.user import User
from app.schemas.order import CurrentOrderResponse, OrderItemResponse, PlaceOrderRequest, PlaceOrderResponse

from ._order_helpers import (
    derive_merchant_name,
    get_or_create_cart,
    get_or_create_order_history,
    get_order_history,
    now_utc,
    resolve_merchant_from_items,
    to_current_order_item,
    to_current_order_item_from_order,
    to_order_history_item,
    _to_int,
)

router = APIRouter()


@router.post("/orders/me/place", response_model=PlaceOrderResponse)
async def place_order_from_cart(
    payload: PlaceOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = get_or_create_cart(db, current_user.id)
    cart_items = cart.items or []

    if not cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")

    history = get_or_create_order_history(db, current_user.id)
    merchant = resolve_merchant_from_items(db, cart_items)
    service_fee = max(_to_int(payload.service_fee, 40), 0)
    total_price = max(_to_int(cart.total_price, 0), 0) + service_fee

    order = Order(
        order_history_id=history.id,
        merchant_id=merchant.id if merchant is not None else None,
        status="pending",
        total_price=total_price,
        items=cart_items,
        delivery_address=payload.delivery_address,
    )
    db.add(order)
    db.flush()

    current_order = CurrentOrder(
        order_id=order.id,
        merchant_id=merchant.id if merchant is not None else None,
        merchant_name=derive_merchant_name(
            cart_items,
            merchant.merchant_name if merchant is not None else f"Order #{order.id}",
        ),
        status="pending",
        shipped=False,
        delivery_fee=service_fee,
        image=payload.image,
    )
    db.add(current_order)

    history.total_orders = _to_int(history.total_orders, 0) + 1
    history.total_spent = _to_int(history.total_spent, 0) + total_price
    history.last_order_at = now_utc()

    cart.items = []
    cart.total_items = 0
    cart.total_price = 0

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

    orders = sorted(history.orders, key=lambda order: order.ordered_at, reverse=True)
    return [to_order_history_item(order) for order in orders]


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
        return [to_current_order_item(current_order) for current_order in current_orders]

    history = get_order_history(db, current_user.id)
    if history is None:
        return []

    active_statuses = {"pending", "processing", "shipped", "out_for_delivery"}
    active_orders = [
        order
        for order in sorted(history.orders, key=lambda item: item.ordered_at, reverse=True)
        if order.status.lower() in active_statuses
    ]
    return [to_current_order_item_from_order(order) for order in active_orders]


# ---------------------------------------------------------------------------
# Merchant order queue routes
# ---------------------------------------------------------------------------

ACTIVE_ORDER_STATUSES = {"pending", "processing", "shipped", "out_for_delivery"}
VALID_ORDER_STATUSES = {"pending", "processing", "shipped", "out_for_delivery", "delivered", "cancelled"}


class OrderStatusUpdate(BaseModel):
    status: str


@router.get("/orders/merchant/current", response_model=list[CurrentOrderResponse])
async def get_merchant_current_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    current_orders = (
        db.query(CurrentOrder)
        .filter(
            CurrentOrder.merchant_id == merchant.id,
            CurrentOrder.status.in_(ACTIVE_ORDER_STATUSES),
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
    merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
    if not merchant:
        raise HTTPException(status_code=403, detail="Only merchants can update order status")

    if status not in VALID_ORDER_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(sorted(VALID_ORDER_STATUSES))}",
        )

    order = db.query(Order).filter(Order.id == order_id, Order.merchant_id == merchant.id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    order.status = status
    if order.current_order:
        order.current_order.status = status
        order.current_order.shipped = status in {"shipped", "out_for_delivery", "delivered"}

    db.commit()
    return {"order_id": order_id, "status": status}


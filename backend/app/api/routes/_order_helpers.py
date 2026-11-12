from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.produce import Produce
from app.services.order_status import (
    SHIPPED_STATUSES,
    auto_confirm_at,
    payment_status,
)


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def get_or_create_cart(db: Session, user_id: int) -> Cart:
    cart = db.query(Cart).filter(Cart.user_id == user_id).first()
    if cart is not None:
        return cart

    cart = Cart(user_id=user_id, items=[])
    db.add(cart)
    try:
        db.commit()
    except IntegrityError:
        # A concurrent request for this user created the cart first.
        db.rollback()
        return db.query(Cart).filter(Cart.user_id == user_id).one()
    db.refresh(cart)
    return cart


def get_order_history(db: Session, user_id: int) -> OrderHistory | None:
    return db.query(OrderHistory).filter(OrderHistory.user_id == user_id).first()


def get_or_create_order_history(db: Session, user_id: int) -> OrderHistory:
    history = get_order_history(db, user_id)
    if history is not None:
        return history

    history = OrderHistory(user_id=user_id)
    try:
        with db.begin_nested():
            db.add(history)
            db.flush()
    except IntegrityError:
        # A concurrent request for this user created the history first.
        return db.query(OrderHistory).filter(OrderHistory.user_id == user_id).one()
    return history


def get_history_orders(db: Session, history: OrderHistory) -> list[Order]:
    return (
        db.query(Order)
        .options(*order_item_load())
        .filter(Order.order_history_id == history.id)
        .all()
    )


def order_item_load() -> tuple:
    """What the order serializers read, loaded in batches instead of per row.

    A function because building these at import time configures the mappers before
    main.py has imported every model.
    """
    return (
        selectinload(Order.merchant).selectinload(Merchant.shop_page),
        selectinload(Order.transactions),
    )


def derive_merchant_name(items: list[dict[str, Any]] | None, fallback: str) -> str:
    for item in items or []:
        if isinstance(item, dict):
            merchant_name = item.get("farm") or item.get("merchant")
            if merchant_name:
                return str(merchant_name)
    return fallback


def _extract_item_int(item: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = item.get(key)
        if value is None:
            continue
        parsed = _to_int(value, default=-1)
        if parsed > 0:
            return parsed
    return None


def resolve_merchant_from_items(
    db: Session, items: list[dict[str, Any]] | None
) -> Merchant | None:
    if not items:
        return None

    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue

        merchant_id = _extract_item_int(raw_item, "merchant_id", "merchantId")
        if merchant_id is not None:
            merchant = db.query(Merchant).filter(Merchant.id == merchant_id).first()
            if merchant is not None:
                return merchant

        produce_id = _extract_item_int(raw_item, "produce_id", "produceId", "id")
        if produce_id is not None:
            produce = db.query(Produce).filter(Produce.id == produce_id).first()
            if produce is not None and produce.merchant is not None:
                return produce.merchant

        merchant_name = raw_item.get("merchant") or raw_item.get("farm")
        if isinstance(merchant_name, str) and merchant_name.strip():
            merchant = (
                db.query(Merchant)
                .filter(
                    func.lower(Merchant.merchant_name) == merchant_name.strip().lower()
                )
                .first()
            )
            if merchant is not None:
                return merchant

    return None


def _get_merchant_page_slug(merchant: Merchant | None) -> str | None:
    if merchant is None or merchant.shop_page is None:
        return None
    return merchant.shop_page.slug


def _get_merchant_logo_url(merchant: Merchant | None) -> str | None:
    if merchant is None or merchant.shop_page is None:
        return None
    return merchant.shop_page.logo_url


def _schedule_fields(order: Order) -> dict[str, Any]:
    """What the buyer chose at checkout, shared by every order serializer."""
    return {
        "delivery_address": order.delivery_address,
        "requested_delivery_date": order.requested_delivery_date,
        "delivery_window": order.delivery_window,
        "notes": order.notes,
    }


def to_order_history_item(order: Order) -> dict[str, Any]:
    items = order.items or []
    merchant = order.merchant
    return {
        "id": order.id,
        "order_id": order.id,
        "merchant": derive_merchant_name(
            items,
            merchant.merchant_name if merchant is not None else f"Order #{order.id}",
        ),
        "merchant_id": merchant.id if merchant is not None else None,
        "merchant_page_slug": _get_merchant_page_slug(merchant),
        "merchant_logo_url": _get_merchant_logo_url(merchant),
        "total_amount": order.total_price,
        "order_date": order.ordered_at,
        "status": order.status,
        "payment_status": payment_status(order),
        "items": items,
        **_schedule_fields(order),
    }


def to_current_order_item(order: Order) -> dict[str, Any]:
    items = order.items or []
    first_item = items[0] if items and isinstance(items[0], dict) else {}
    merchant = order.merchant
    merchant_name = (
        merchant.merchant_name
        if merchant is not None
        else derive_merchant_name(items, f"Order #{order.id}")
    )
    return {
        "id": order.id,
        "order_id": order.id,
        "merchant": merchant_name,
        "merchant_id": merchant.id if merchant is not None else None,
        "merchant_page_slug": _get_merchant_page_slug(merchant),
        "merchant_logo_url": _get_merchant_logo_url(merchant),
        "shipped": order.status in SHIPPED_STATUSES,
        "date_bought": order.ordered_at,
        "time_of_arrival": order.time_of_arrival,
        "shipped_at": order.shipped_at,
        "auto_confirm_at": auto_confirm_at(order),
        # Orders placed before delivery_fee existed kept it on the item.
        "delivery_fee": order.delivery_fee
        or _to_int(first_item.get("deliveryFee", 0)),
        "image": order.image or first_item.get("image"),
        "status": order.status,
        "payment_status": payment_status(order),
        "items": items,
        "total_amount": order.total_price,
        **_schedule_fields(order),
    }


def now_utc() -> datetime:
    return datetime.now(UTC)

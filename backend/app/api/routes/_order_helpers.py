from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.cart import Cart
from app.models.current_orders import CurrentOrder
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.produce import Produce


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def compute_cart_totals(items: list[dict[str, Any]]) -> tuple[int, int]:
    total_items = 0
    total_price = 0
    for item in items:
        quantity = max(_to_int(item.get("quantity"), 0), 0)
        unit_price = max(_to_int(item.get("price"), 0), 0)
        total_items += quantity
        total_price += quantity * unit_price
    return total_items, total_price


def get_or_create_cart(db: Session, user_id: int) -> Cart:
    cart = db.query(Cart).filter(Cart.user_id == user_id).first()
    if cart is not None:
        return cart

    cart = Cart(user_id=user_id, items=[], total_items=0, total_price=0)
    db.add(cart)
    db.commit()
    db.refresh(cart)
    return cart


def get_order_history(db: Session, user_id: int) -> OrderHistory | None:
    return db.query(OrderHistory).filter(OrderHistory.user_id == user_id).first()


def get_or_create_order_history(db: Session, user_id: int) -> OrderHistory:
    history = get_order_history(db, user_id)
    if history is not None:
        return history

    history = OrderHistory(user_id=user_id, total_orders=0, total_spent=0)
    db.add(history)
    db.flush()
    return history


def derive_merchant_name(items: list[dict[str, Any]] | None, fallback: str) -> str:
    if not items:
        return fallback
    first_item = items[0]
    if isinstance(first_item, dict):
        merchant_name = first_item.get("farm") or first_item.get("merchant")
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


def resolve_merchant_from_items(db: Session, items: list[dict[str, Any]] | None) -> Merchant | None:
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
                .filter(func.lower(Merchant.merchant_name) == merchant_name.strip().lower())
                .first()
            )
            if merchant is not None:
                return merchant

    return None


def _get_merchant_page_slug(merchant: Merchant | None) -> str | None:
    if merchant is None or merchant.shop_page is None:
        return None
    return merchant.shop_page.slug


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
        "total_amount": order.total_price,
        "order_date": order.ordered_at,
        "status": order.status,
        "items": items,
    }


def to_current_order_item_from_order(order: Order) -> dict[str, Any]:
    items = order.items or []
    first_item = items[0] if items and isinstance(items[0], dict) else {}
    merchant = order.merchant
    merchant_name = derive_merchant_name(
        items,
        merchant.merchant_name if merchant is not None else f"Order #{order.id}",
    )
    return {
        "id": order.id,
        "order_id": order.id,
        "merchant": merchant_name,
        "merchant_id": merchant.id if merchant is not None else None,
        "merchant_page_slug": _get_merchant_page_slug(merchant),
        "shipped": order.status.lower() in {"shipped", "out_for_delivery", "delivered"},
        "date_bought": order.ordered_at,
        "time_of_arrival": None,
        "delivery_fee": int(first_item.get("deliveryFee", 0) if isinstance(first_item, dict) else 0),
        "image": first_item.get("image") if isinstance(first_item, dict) else None,
        "status": order.status,
    }


def to_current_order_item(current_order: CurrentOrder) -> dict[str, Any]:
    order = current_order.order
    items = order.items or []
    first_item = items[0] if items and isinstance(items[0], dict) else {}
    merchant = current_order.merchant or order.merchant
    return {
        "id": current_order.id,
        "order_id": current_order.order_id,
        "merchant": current_order.merchant_name,
        "merchant_id": merchant.id if merchant is not None else None,
        "merchant_page_slug": _get_merchant_page_slug(merchant),
        "shipped": current_order.shipped,
        "date_bought": order.ordered_at,
        "time_of_arrival": current_order.time_of_arrival,
        "delivery_fee": current_order.delivery_fee,
        "image": current_order.image or (first_item.get("image") if isinstance(first_item, dict) else None),
        "status": current_order.status,
    }


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


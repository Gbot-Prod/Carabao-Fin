from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, Literal

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Query, Session, selectinload

from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.services import store_pause
from app.services.merchant_verification import merchant_can_sell
from app.services.order_status import (
    SHIPPED_STATUSES,
    auto_confirm_at,
    payment_status,
)
from app.services.produce_freshness import is_expired, is_withdrawn
from app.services.review_service import can_review, review_deadline


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def merchant_takes_orders(merchant: Merchant | None) -> bool:
    """Verified to sell (merchant_can_sell: not closed, not suspended), the
    owner is not banned, and the farm is not in holiday mode (CF-0066).

    Only new orders are checked: an order already placed still completes if
    the merchant is suspended later."""
    return (
        merchant is not None
        and merchant_can_sell(merchant)
        and (merchant.user is None or not merchant.user.is_suspended)
        and not store_pause.is_paused(merchant)
    )


# Why place-order would refuse a cart line. One check for both forms the cart
# answer carries: `issue` is a code (web loop CF-0042), `unavailable_reason` a
# short text (main CF-0052). The texts are what mobile and the web cart show.
CartIssue = Literal[
    "unavailable",  # listing deleted or hidden by an admin
    "expired",  # past its best-before date
    "farm_unavailable",  # farm closed, suspended, paused, or owner banned
    "own_listing",  # the buyer's own farm (CF-0039)
    "below_minimum",  # quantity under the listing's minimum order
    "exceeds_stock",  # quantity over the stock left
]

_ISSUE_TEXT: dict[str, str] = {
    "unavailable": "is no longer available",
    "expired": "is past its best-before date",
    "farm_unavailable": "is from a farm that isn't taking orders",
    "own_listing": "is from your own farm",
}


def is_own_produce(produce: Produce, buyer_id: int | None) -> bool:
    """The buyer owns the farm that sells ``produce`` (CF-0039)."""
    merchant = produce.merchant
    return (
        merchant is not None and buyer_id is not None and merchant.user_id == buyer_id
    )


def cart_line_issue(
    produce: Produce | None, quantity: int, buyer_id: int | None, today: date
) -> CartIssue | None:
    """The first reason checkout would refuse this line, or None."""
    if produce is None or is_withdrawn(produce):
        return "unavailable"
    if is_expired(produce, today):
        return "expired"
    if not merchant_takes_orders(produce.merchant):
        return "farm_unavailable"
    if is_own_produce(produce, buyer_id):
        return "own_listing"
    if quantity < (produce.min_order_qty or 1):
        return "below_minimum"
    if (produce.stock_quantity or 0) < quantity:
        return "exceeds_stock"
    return None


def line_problem(
    produce: Produce, quantity: int, buyer_id: int | None, today: date
) -> str | None:
    """Why checkout would refuse this cart line, or None (CF-0052).

    The same rules place-order applies, so the cart cannot hold a line that
    fails checkout. Stock is not part of this text: it changes all the time,
    and the cart shows ``stock_quantity`` (and the ``exceeds_stock`` issue)
    for the client to cap the quantity.
    """
    issue = cart_line_issue(produce, quantity, buyer_id, today)
    if issue is None or issue == "exceeds_stock":
        return None
    if issue == "below_minimum":
        return f"has a minimum order of {produce.min_order_qty}"
    return _ISSUE_TEXT[issue]


def cart_line(
    produce: Produce,
    quantity: int,
    unit_price: int,
    unavailable_reason: str | None = None,
) -> dict[str, Any]:
    """One cart line, built only from the produce row (CF-0008).

    The client sends produce_id and quantity; name, price, image and the
    merchant fields always come from here, so a client cannot change them.
    """
    merchant = produce.merchant
    return {
        "unavailable_reason": unavailable_reason,
        "id": str(produce.id),
        "produce_id": produce.id,
        "produce": produce.name,
        "unit": produce.unit,
        "image": produce.image_url,
        "price": unit_price,
        "quantity": quantity,
        "min_order_qty": produce.min_order_qty,
        "stock_quantity": produce.stock_quantity,
        "merchant_id": merchant.id if merchant is not None else None,
        "farm": merchant.merchant_name if merchant is not None else None,
        "delivery_fee": (merchant.delivery_price or 0) if merchant is not None else 0,
    }


def order_line(produce: Produce, quantity: int, unit_price: int) -> dict[str, Any]:
    """One orders.items entry: a snapshot of the listing at checkout."""
    merchant = produce.merchant
    return {
        "id": str(produce.id),
        "produce_id": produce.id,
        "produce": produce.name,
        "name": produce.name,
        "unit": produce.unit,
        "image": produce.image_url,
        "price": unit_price,
        "quantity": quantity,
        "merchant_id": produce.merchant_id,
        "farm": merchant.merchant_name if merchant is not None else None,
    }


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


def buyer_orders_query(db: Session, user_id: int) -> Query[Order]:
    """The buyer's orders, newest first, sorted by the database (CF-0036).
    Orders the buyer hid from history are left out (CF-0070)."""
    return (
        db.query(Order)
        .filter(Order.user_id == user_id, Order.hidden_by_buyer_at.is_(None))
        .order_by(Order.ordered_at.desc().nulls_last(), Order.id.desc())
    )


def get_buyer_orders(db: Session, user_id: int) -> list[Order]:
    return buyer_orders_query(db, user_id).options(*order_item_load()).all()


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


def to_order_history_item(order: Order, reviewed: bool = False) -> dict[str, Any]:
    """One card in the buyer's order list. ``reviewed``: the buyer has left a
    review for this order (the caller looks it up for the whole page)."""
    items = order.items or []
    first_item = items[0] if items and isinstance(items[0], dict) else {}
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
        # Orders placed before delivery_fee existed kept it on the item.
        "delivery_fee": order.delivery_fee
        or _to_int(first_item.get("deliveryFee", 0)),
        "discount": order.discount or 0,
        "time_of_arrival": order.time_of_arrival,
        "auto_confirm_at": auto_confirm_at(order),
        "delivered_at": order.delivered_at,
        "reviewed": reviewed,
        "can_review": not reviewed and can_review(order),
        "review_deadline": review_deadline(order),
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
        "discount": order.discount or 0,
        "voucher_code": order.voucher_code,
        **_schedule_fields(order),
    }


def now_utc() -> datetime:
    return datetime.now(UTC)

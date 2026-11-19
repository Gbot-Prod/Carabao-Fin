from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db, require_verified_phone
from app.core.sql import ilike_contains
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.models.review import Review
from app.models.statuses import OrderStatus
from app.models.user import User
from app.models.voucher import Voucher
from app.schemas.order import (
    CurrentOrderResponse,
    OrderDetailResponse,
    OrderItemResponse,
    PlacedOrder,
    PlaceOrderRequest,
    PlaceOrderResponse,
    VoucherPreviewRequest,
    VoucherPreviewResponse,
)
from app.schemas.pagination import Page
from app.schemas.receipt import ReceiptResponse
from app.services import notifications, rate_limit, store_pause, vouchers
from app.services.merchant_service import get_active_merchant
from app.services.order_reservations import (
    MAX_OPEN_PENDING_ORDERS,
    expire_stale_reservations,
    open_pending_order_count,
    reservation_ttl_minutes,
)
from app.services.order_status import (
    ACTIVE_ORDER_STATUSES,
    CLOSED_ORDER_STATUSES,
    IN_TRANSIT_STATUSES,
    mark_delivered,
    money_received_clause,
)
from app.services.pinned_location import validate_pin
from app.services.produce_freshness import is_expired, ph_today
from app.services.produce_pricing import unit_price_for
from app.services.receipts import build_receipt, receipt_payment
from app.services.review_service import (
    can_review,
    review_deadline,
    to_review_response,
)
from app.services.service_area import (
    DELIVERY_OUTSIDE_LUZON_DETAIL,
    OUTSIDE_LUZON_DETAIL,
    address_in_luzon,
    is_luzon_region,
)

from ._order_helpers import (
    _extract_item_int,
    _to_int,
    buyer_orders_query,
    get_buyer_orders,
    get_or_create_cart,
    merchant_takes_orders,
    order_item_load,
    order_line,
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
    current_user: User = Depends(require_verified_phone),
):
    rate_limit.enforce_action(db, "order_place", str(current_user.id))
    # Carabao delivers within Luzon only (B2).
    if payload.delivery_region is not None:
        if not is_luzon_region(payload.delivery_region):
            raise HTTPException(status_code=400, detail=OUTSIDE_LUZON_DETAIL)
    elif payload.delivery_address and not address_in_luzon(payload.delivery_address):
        raise HTTPException(status_code=400, detail=DELIVERY_OUTSIDE_LUZON_DETAIL)
    delivery_pin = validate_pin(payload.delivery_lat, payload.delivery_lng)

    # Release any elapsed checkout holds before checking availability.
    expire_stale_reservations(db, reservation_ttl_minutes())
    if open_pending_order_count(db, current_user) >= MAX_OPEN_PENDING_ORDERS:
        raise HTTPException(
            status_code=409,
            detail=(
                f"You have {MAX_OPEN_PENDING_ORDERS} unpaid orders. Pay or cancel "
                "them in My Orders before placing another."
            ),
        )
    cart = get_or_create_cart(db, current_user.id)
    cart_items = cart.items or []
    if not cart_items:
        raise HTTPException(status_code=400, detail="Cart is empty")
    requested_day = payload.delivery_date
    if requested_day is not None and requested_day < datetime.now(_PH_TZ).date():
        raise HTTPException(
            status_code=400, detail="Delivery date cannot be in the past"
        )

    today = ph_today()
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
    # CF-0040: a merchant may not buy from their own farm. Self-orders could be
    # confirmed as delivered by the same person and then reviewed (rating
    # inflation) or used to fake sales history.
    own_merchant_id = (
        db.query(Merchant.id).filter(Merchant.user_id == current_user.id).scalar()
    )
    items_by_merchant: dict[int, list[dict]] = {}
    subtotal_by_merchant: dict[int, int] = {}
    for item in cart_items:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Invalid cart item")

        produce_id = _extract_item_int(item, "produce_id", "produceId", "id")
        if produce_id is None:
            raise HTTPException(
                status_code=400, detail="Cart item is missing a produce ID"
            )

        produce = locked_produce.get(produce_id)
        if produce is None:
            raise HTTPException(
                status_code=400, detail=f"Produce ID {produce_id} not found"
            )
        if own_merchant_id is not None and produce.merchant_id == own_merchant_id:
            raise HTTPException(
                status_code=400,
                detail=f"'{produce.name}' is from your own farm. Remove it from "
                "your cart to continue.",
            )
        if produce.hidden_at is not None:
            raise HTTPException(
                status_code=400,
                detail=f"'{produce.name}' is no longer available",
            )
        if is_expired(produce, today):
            raise HTTPException(
                status_code=400,
                detail=f"'{produce.name}' is past its best-before date",
            )

        quantity = max(_to_int(item.get("quantity"), 0), 0)
        if quantity == 0:
            raise HTTPException(
                status_code=400, detail="Item quantity must be positive"
            )
        if quantity < produce.min_order_qty:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"'{produce.name}' has a minimum order of "
                    f"{produce.min_order_qty}, {quantity} requested"
                ),
            )
        if produce.stock_quantity < quantity:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Insufficient stock for '{produce.name}': "
                    f"{produce.stock_quantity} available, {quantity} requested"
                ),
            )

        produce.stock_quantity -= quantity
        unit_price = unit_price_for(produce, quantity)
        line = order_line(produce, quantity, unit_price)
        items_by_merchant.setdefault(produce.merchant_id, []).append(line)
        subtotal_by_merchant[produce.merchant_id] = (
            subtotal_by_merchant.get(produce.merchant_id, 0) + unit_price * quantity
        )

    # CF-0058: a farm voucher lowers that farm's produce subtotal only (not
    # the delivery fee). Checked after the stock lines, so its minimum spend
    # is measured on the prices this checkout really uses.
    voucher: Voucher | None = None
    discount_by_merchant: dict[int, int] = {}
    if payload.voucher_code and payload.voucher_code.strip():
        voucher, voucher_discount = vouchers.claim(
            db, payload.voucher_code, subtotal_by_merchant, cast(int, current_user.id)
        )
        discount_by_merchant[cast(int, voucher.merchant_id)] = voucher_discount

    # One order per merchant (C1); all of them or none (single commit below).
    # Shared locks, in id order: checkouts don't block each other, but a
    # concurrent merchant deletion either waits for these orders or is seen here.
    orders: list[tuple[Order, Merchant]] = []
    for merchant_id in sorted(items_by_merchant):
        merchant = (
            db.query(Merchant)
            .filter(Merchant.id == merchant_id)
            .with_for_update(read=True)
            .populate_existing()
            .first()
        )
        if merchant is not None and store_pause.is_paused(merchant):
            raise HTTPException(
                status_code=400, detail=store_pause.pause_detail(merchant)
            )
        if not merchant_takes_orders(merchant):
            name = merchant.merchant_name if merchant is not None else "A merchant"
            raise HTTPException(
                status_code=400,
                detail=f"{name} is no longer accepting orders. Remove their items "
                "from your cart to continue.",
            )
        service_fee = merchant.delivery_price or 0
        discount = discount_by_merchant.get(merchant_id, 0)
        order = Order(
            user_id=current_user.id,
            merchant_id=merchant.id,
            status=OrderStatus.PENDING,
            total_price=subtotal_by_merchant[merchant_id] + service_fee - discount,
            discount=discount,
            voucher_code=voucher.code if discount and voucher is not None else None,
            items=items_by_merchant[merchant_id],
            delivery_address=(payload.delivery_address or "").strip() or None,
            delivery_lat=delivery_pin[0] if delivery_pin else None,
            delivery_lng=delivery_pin[1] if delivery_pin else None,
            requested_delivery_date=payload.delivery_date,
            delivery_window=(payload.delivery_time or "").strip() or None,
            notes=(payload.notes or "").strip() or None,
            delivery_fee=service_fee,
            image=items_by_merchant[merchant_id][0].get("image"),
        )
        db.add(order)
        orders.append((order, merchant))

    db.flush()  # ids for the notifications below
    for order, merchant in orders:
        if voucher is not None and order.discount:
            buyer_id = cast(int, current_user.id)
            vouchers.record(db, voucher, order, buyer_id, cast(int, order.discount))
        notifications.notify(
            db,
            current_user.id,
            notifications.ORDER_PLACED,
            f"Order {notifications.order_ref(order)} placed",
            f"From {merchant.merchant_name}. Pay to confirm it.",
            f"/orders/{order.id}",
        )

    db.commit()
    placed = []
    for order, merchant in orders:
        db.refresh(order)
        placed.append(
            PlacedOrder(
                order_id=order.id,
                order_reference=notifications.order_ref(order),
                status=order.status,
                merchant_id=merchant.id,
                merchant_name=merchant.merchant_name,
                total_price=order.total_price,
                delivery_fee=order.delivery_fee,
                discount=order.discount or 0,
                voucher_code=order.voucher_code,
            )
        )

    first = placed[0]
    return PlaceOrderResponse(
        order_id=first.order_id,
        order_reference=first.order_reference,
        status=first.status,
        orders=placed,
    )


@router.post("/orders/me/voucher-preview", response_model=VoucherPreviewResponse)
def preview_voucher(
    payload: VoucherPreviewRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> VoucherPreviewResponse:
    """CF-0064: the discount a code would give on the buyer's cart now.

    Reads the cart and listings like place-order but holds no stock and
    records nothing. Lines place-order would refuse (hidden, expired, own
    farm, unknown) are left out of the subtotal; place-order still refuses
    them. Limited per buyer, since each call tests a code.
    """
    rate_limit.enforce_action(db, "voucher_preview", str(current_user.id))
    cart = get_or_create_cart(db, cast(int, current_user.id))
    own_merchant_id = (
        db.query(Merchant.id).filter(Merchant.user_id == current_user.id).scalar()
    )
    today = ph_today()
    lines: dict[int, int] = {}
    cart_items: list[Any] = list(cast(Any, cart.items) or [])
    for item in cart_items:
        if not isinstance(item, dict):
            continue
        produce_id = _extract_item_int(item, "produce_id", "produceId", "id")
        quantity = max(_to_int(item.get("quantity"), 0), 0)
        if produce_id is not None and quantity > 0:
            lines[produce_id] = lines.get(produce_id, 0) + quantity
    subtotal_by_merchant: dict[int, int] = {}
    if lines:
        preview_rows = (
            db.query(Produce)
            .options(selectinload(Produce.merchant))
            .filter(Produce.id.in_(list(lines)))
            .all()
        )
        for produce in preview_rows:
            merchant_id = cast(int, produce.merchant_id)
            if (
                produce.hidden_at is not None
                or is_expired(produce, today)
                or merchant_id == own_merchant_id
                # CF-0072 (B83): checkout refuses a paused farm's lines.
                or store_pause.is_paused(produce.merchant, today)
            ):
                continue
            quantity = lines[cast(int, produce.id)]
            subtotal_by_merchant[merchant_id] = (
                subtotal_by_merchant.get(merchant_id, 0)
                + unit_price_for(produce, quantity) * quantity
            )
    if not subtotal_by_merchant:
        raise HTTPException(status_code=400, detail="Cart is empty")
    voucher, discount = vouchers.claim(
        db, payload.voucher_code, subtotal_by_merchant, cast(int, current_user.id)
    )
    merchant = db.get(Merchant, voucher.merchant_id)
    response = VoucherPreviewResponse(
        code=cast(str, voucher.code),
        merchant_id=cast(int, voucher.merchant_id),
        merchant_name=merchant.merchant_name if merchant is not None else "",
        discount=discount,
    )
    db.rollback()  # release the voucher row lock; nothing was changed
    return response


@router.get("/orders/me/history", response_model=list[OrderItemResponse])
def get_my_order_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every order, newest first. Kept as a plain list for the mobile app;
    the web uses the paged ``/orders/me/history/page``."""
    orders = get_buyer_orders(db, current_user.id)
    return [to_order_history_item(order) for order in orders]


# CF-0036: filter groups the history page offers.
HistoryFilter = Literal["active", "delivered", "cancelled"]
_HISTORY_FILTER_STATUSES: dict[str, frozenset[OrderStatus]] = {
    "active": ACTIVE_ORDER_STATUSES,
    "delivered": frozenset({OrderStatus.DELIVERED}),
    # A payment mismatch is closed without delivery; the buyer sees it here.
    "cancelled": frozenset({OrderStatus.CANCELLED, OrderStatus.PAYMENT_MISMATCH}),
}
# "CB-2026-0042", "cb-2026-42", "#42" or "42": the order id.
_ORDER_REF = re.compile(r"^(?:cb-\d{4}-)?#?0*(\d{1,9})$", re.IGNORECASE)


@router.get("/orders/me/history/page", response_model=Page[OrderItemResponse])
def get_my_order_history_page(
    status: HistoryFilter | None = None,
    q: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1, le=10_000),
    page_size: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """One page of the buyer's orders, newest first (CF-0036).

    ``q`` matches an order reference or the farm name. Sorting, filtering
    and paging happen in SQL, so a long history is not loaded at once.
    """
    # Legacy Column-typed model: the loaded attribute is an int.
    query = buyer_orders_query(db, cast(int, current_user.id))
    if status is not None:
        query = query.filter(Order.status.in_(_HISTORY_FILTER_STATUSES[status]))
    term = (q or "").strip()
    if term:
        ref = _ORDER_REF.match(term)
        if ref:
            query = query.filter(Order.id == int(ref.group(1)))
        else:
            query = query.outerjoin(Merchant, Order.merchant_id == Merchant.id).filter(
                ilike_contains(Merchant.merchant_name, term)
            )

    total = query.order_by(None).count()
    orders = (
        query.options(*order_item_load())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [to_order_history_item(order) for order in orders],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.delete("/orders/me/history/{order_id}", status_code=204)
def delete_order_from_history(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = (
        db.query(Order)
        .filter(Order.id == order_id, Order.user_id == current_user.id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status not in CLOSED_ORDER_STATUSES:
        raise HTTPException(
            status_code=400, detail="Only completed orders can be removed"
        )
    # CF-0070 (B10): hide, never delete. Payments (a non-null FK), the farm's
    # sales, refunds and the review all keep their order. Hiding twice is fine.
    if order.hidden_by_buyer_at is None:
        order.hidden_by_buyer_at = datetime.now(UTC)
        db.commit()


@router.get("/orders/me/current", response_model=list[CurrentOrderResponse])
def get_my_current_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    orders = (
        db.query(Order)
        .options(*order_item_load())
        .filter(
            Order.user_id == current_user.id,
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
        .filter(Order.id == order_id, Order.user_id == current_user.id)
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


@router.get("/orders/me/{order_id}/receipt", response_model=ReceiptResponse)
def get_my_order_receipt(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ReceiptResponse:
    """CF-0049: the buyer's receipt for a paid order (also after a refund)."""
    order = (
        db.query(Order)
        .options(selectinload(Order.merchant), selectinload(Order.user))
        .filter(Order.id == order_id, Order.user_id == current_user.id)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    payment = receipt_payment(db, order)
    if payment is None:
        raise HTTPException(
            status_code=409, detail="This order has no payment yet, so no receipt."
        )
    return build_receipt(order, payment)


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
        .filter(Order.id == order_id, Order.user_id == current_user.id)
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

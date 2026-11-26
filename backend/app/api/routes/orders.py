from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import ColumnElement, TextClause, or_, text
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db, require_verified_phone
from app.core.sql import LIKE_ESCAPE, contains_pattern, ilike_contains
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_proof_photo import OrderProofPhoto
from app.models.produce import Produce
from app.models.review import Review
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.user import User
from app.models.user_address import UserAddress
from app.schemas.order import (
    CurrentOrderResponse,
    OrderDetailResponse,
    OrderItemResponse,
    PlacedOrder,
    PlaceOrderRequest,
    PlaceOrderResponse,
)
from app.schemas.pagination import MAX_PAGE, Page
from app.schemas.receipt import ReceiptResponse
from app.services import (
    delivery_dispute,
    notifications,
    order_proof,
    rate_limit,
    store_pause,
)
from app.services.merchant_service import get_active_merchant
from app.services.order_reservations import (
    MAX_OPEN_PENDING_ORDERS,
    expire_stale_reservations,
    open_pending_order_count,
    release_order_reservation,
    reservation_ttl_minutes,
)
from app.services.order_status import (
    ACTIVE_ORDER_STATUSES,
    CLOSED_ORDER_STATUSES,
    IN_TRANSIT_STATUSES,
    cancel_paid_order,
    mark_delivered,
    money_received_clause,
)
from app.services.pinned_location import (
    enforce_not_flagged,
    needs_road_check,
    saved_pin_confirmed,
    validate_pin,
)
from app.services.produce_freshness import is_expired, is_withdrawn, ph_today
from app.services.produce_pricing import unit_price_for
from app.services.psgc import LUZON_REGION_CODES
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
    is_own_produce,
    merchant_takes_orders,
    order_item_load,
    order_line,
    to_current_order_item,
    to_order_history_item,
)

router = APIRouter(tags=["orders"])


def _order_produce_ids(items: list[Any] | None) -> set[int]:
    return {
        produce_id
        for item in items or []
        if isinstance(item, dict)
        and (produce_id := _extract_item_int(item, "produce_id", "produceId", "id"))
        is not None
    }


def release_superseded_orders(db: Session, user_id: int, produce_ids: set[int]) -> None:
    """Cancel the buyer's unpaid orders for any of ``produce_ids`` (CF-0047).

    Cart lines stay in the cart until their order is paid, so checking out
    again would otherwise hold the same stock twice and let the buyer pay
    twice. The new checkout replaces the old unpaid order: its stock comes
    back and its PayMongo session is closed. Raises 409 while a payment for
    the old order may still go through.
    """
    pending = (
        db.query(Order)
        .filter(Order.user_id == user_id, Order.status == OrderStatus.PENDING)
        .order_by(Order.id)
        .with_for_update()
        .populate_existing()
        .all()
    )
    for order in pending:
        if not _order_produce_ids(order.items) & produce_ids:
            continue
        if not release_order_reservation(
            order, db, transaction_status=TransactionStatus.EXPIRED
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"A payment for order {notifications.order_ref(order)} is still "
                    "in progress. Wait a minute, then try again."
                ),
            )


# The fields a saved address (delivery_address_id) gives in their place.
_SAVED_ADDRESS_FIELDS = (
    "delivery_address",
    "delivery_region",
    "delivery_lat",
    "delivery_lng",
    "delivery_pin_confirmed",
)


def saved_address_line(address: UserAddress) -> str:
    """The delivery text an order keeps: street, barangay, city, province and
    postal code."""
    parts = [
        address.address,
        address.barangay,
        address.city,
        address.province,
        address.postal_code,
    ]
    return ", ".join(str(p).strip() for p in parts if p and str(p).strip())


def _saved_delivery_address(
    db: Session, user: User, payload: PlaceOrderRequest
) -> UserAddress | None:
    if payload.delivery_address_id is None:
        return None
    sent = sorted(f for f in _SAVED_ADDRESS_FIELDS if f in payload.model_fields_set)
    if sent:
        raise HTTPException(
            status_code=422,
            detail=f"Leave out {', '.join(sent)} when delivery_address_id is sent",
        )
    address = (
        db.query(UserAddress)
        .filter(
            UserAddress.id == payload.delivery_address_id,
            UserAddress.user_id == user.id,
        )
        .first()
    )
    if address is None:
        raise HTTPException(status_code=404, detail="Address not found")
    if address.region_code is None:
        raise HTTPException(
            status_code=400,
            detail="Add the region, province, city and barangay to this address first",
        )
    if address.region_code not in LUZON_REGION_CODES:
        raise HTTPException(status_code=400, detail=OUTSIDE_LUZON_DETAIL)
    return address


@router.post("/orders/me/place", response_model=PlaceOrderResponse)
def place_order_from_cart(
    payload: PlaceOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_verified_phone),
):
    rate_limit.enforce_action(db, "order_place", str(current_user.id))
    saved = _saved_delivery_address(db, current_user, payload)
    delivery_address = (payload.delivery_address or "").strip() or None
    # Carabao delivers within Luzon only (B2).
    if saved is not None:
        # The saved row's area was checked against the PSGC when it was saved.
        delivery_address = saved_address_line(saved)
        delivery_pin = validate_pin(saved.lat, saved.lng)
    else:
        if payload.delivery_region is not None:
            if not is_luzon_region(payload.delivery_region):
                raise HTTPException(status_code=400, detail=OUTSIDE_LUZON_DETAIL)
        elif delivery_address and not address_in_luzon(delivery_address):
            raise HTTPException(status_code=400, detail=DELIVERY_OUTSIDE_LUZON_DETAIL)
        delivery_pin = validate_pin(payload.delivery_lat, payload.delivery_lng)
    road = delivery_pin.road if delivery_pin else None
    if saved is not None and road is not None and needs_road_check(saved):
        # Saved while the road service was down: keep the road found now.
        saved.road_lat, saved.road_lng = road
    if saved is not None:
        pin_confirmed = bool(delivery_pin and saved.pin_confirmed)
    elif payload.delivery_pin_confirmed is not None:
        pin_confirmed = bool(delivery_pin and payload.delivery_pin_confirmed)
    else:
        pin_confirmed = any(
            saved_pin_confirmed(saved, delivery_pin.pin if delivery_pin else None)
            for saved in current_user.addresses
        )
    # Control 6: a place riders reported more than once must be re-pinned.
    enforce_not_flagged(
        db, cast(int, current_user.id), delivery_pin.pin if delivery_pin else None
    )

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
    if payload.produce_ids is not None:
        # Check out only the ticked lines; the rest stay in the cart.
        selected = set(payload.produce_ids)
        cart_items = [
            item
            for item in cart_items
            if isinstance(item, dict)
            and _extract_item_int(item, "produce_id", "produceId", "id") in selected
        ]
        if not cart_items:
            raise HTTPException(
                status_code=400, detail="None of the selected items are in your cart"
            )
    release_superseded_orders(db, current_user.id, _order_produce_ids(cart_items))

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
        if is_withdrawn(produce):
            raise HTTPException(
                status_code=400,
                detail=f"'{produce.name}' is no longer available",
            )
        if is_expired(produce, today):
            raise HTTPException(
                status_code=400,
                detail=f"'{produce.name}' is past its best-before date",
            )
        if is_own_produce(produce, current_user.id):
            # CF-0039: no buying (and then reviewing) your own farm's produce.
            raise HTTPException(
                status_code=400,
                detail=f"'{produce.name}' is from your own farm",
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
        order = Order(
            user_id=current_user.id,
            merchant_id=merchant.id,
            status=OrderStatus.PENDING,
            total_price=subtotal_by_merchant[merchant_id] + service_fee,
            items=items_by_merchant[merchant_id],
            delivery_address=delivery_address,
            delivery_lat=delivery_pin.pin[0] if delivery_pin else None,
            delivery_lng=delivery_pin.pin[1] if delivery_pin else None,
            delivery_road_lat=road[0] if road else None,
            delivery_road_lng=road[1] if road else None,
            delivery_pin_confirmed=pin_confirmed,
            notes=(payload.notes or "").strip() or None,
            delivery_fee=service_fee,
            image=items_by_merchant[merchant_id][0].get("image"),
        )
        db.add(order)
        orders.append((order, merchant))

    db.flush()  # ids for the notifications below
    for order, merchant in orders:
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
            )
        )

    first = placed[0]
    return PlaceOrderResponse(
        order_id=first.order_id,
        order_reference=first.order_reference,
        status=first.status,
        orders=placed,
    )


@router.get("/orders/me/history", response_model=list[OrderItemResponse])
def get_my_order_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Every order, newest first. Kept as a plain list for the mobile app;
    the web uses the paged ``/orders/me/history/page``."""
    orders = get_buyer_orders(db, current_user.id)
    return [to_order_history_item(order) for order in orders]


# CF-0036: filter groups the history page offers. The web order tabs use
# to_pay / to_ship / to_receive / delivered / cancelled; mobile uses active.
HistoryFilter = Literal[
    "active", "to_pay", "to_ship", "to_receive", "delivered", "cancelled"
]
_HISTORY_FILTER_STATUSES: dict[str, frozenset[OrderStatus]] = {
    "active": ACTIVE_ORDER_STATUSES,
    "to_pay": frozenset({OrderStatus.PENDING}),
    "to_ship": frozenset({OrderStatus.PROCESSING}),
    "to_receive": frozenset({OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY}),
    "delivered": frozenset({OrderStatus.DELIVERED}),
    # A payment mismatch is closed without delivery; the buyer sees it here.
    "cancelled": frozenset({OrderStatus.CANCELLED, OrderStatus.PAYMENT_MISMATCH}),
}
# "CB-2026-0042", "cb-2026-42", "#42" or "42": the order id.
_ORDER_REF = re.compile(r"^(?:cb-\d{4}-)?#?0*(\d{1,9})$", re.IGNORECASE)

# An order line's product name ("produce" on each item of orders.items).
# Postgres and SQLite (the tests) read JSON arrays with different functions.
_ITEM_NAME_MATCH = {
    "postgresql": (
        "CASE WHEN json_typeof(orders.items) = 'array' THEN EXISTS ("
        "SELECT 1 FROM json_array_elements(orders.items) AS line "
        "WHERE line->>'produce' ILIKE :item_q ESCAPE :item_esc) ELSE false END"
    ),
    "sqlite": (
        "EXISTS (SELECT 1 FROM json_each(orders.items) AS line "
        "WHERE json_extract(line.value, '$.produce') LIKE :item_q ESCAPE :item_esc)"
    ),
}


def _item_name_matches(db: Session, term: str) -> TextClause | None:
    """Orders with a line whose product name contains ``term``, or None when
    the database is not one we know how to search."""
    clause = _ITEM_NAME_MATCH.get(db.get_bind().dialect.name)
    if clause is None:
        return None
    return text(clause).bindparams(item_q=contains_pattern(term), item_esc=LIKE_ESCAPE)


@router.get("/orders/me/history/page", response_model=Page[OrderItemResponse])
def get_my_order_history_page(
    status: HistoryFilter | None = None,
    q: str | None = Query(None, max_length=100),
    page: int = Query(1, ge=1, le=MAX_PAGE),
    page_size: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """One page of the buyer's orders, newest first (CF-0036).

    ``q`` matches an order reference, the farm name or a product name.
    Sorting, filtering and paging happen in SQL, so a long history is not
    loaded at once.
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
            matches: list[ColumnElement[bool] | TextClause] = [
                ilike_contains(Merchant.merchant_name, term)
            ]
            by_item = _item_name_matches(db, term)
            if by_item is not None:
                matches.append(by_item)
            query = query.outerjoin(Merchant, Order.merchant_id == Merchant.id).filter(
                or_(*matches)
            )

    total = query.order_by(None).count()
    orders = (
        query.options(*order_item_load())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    reviewed = {
        order_id
        for (order_id,) in db.query(Review.order_id).filter(
            Review.order_id.in_([order.id for order in orders])
        )
    }
    return {
        "items": [to_order_history_item(o, o.id in reviewed) for o in orders],
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
        cancel_reason=order.cancel_reason,
        review=to_review_response(review, order) if review else None,
        can_review=review is None and can_review(order),
        review_deadline=review_deadline(order),
        proof_photos=_buyer_photo_kinds(db, order.id),
        dispute_until=delivery_dispute.dispute_until(order),
        can_dispute=delivery_dispute.can_dispute(order),
        delivery_buyer_confirmed_at=order.delivery_buyer_confirmed_at,
        delivery_disputed_at=order.delivery_disputed_at,
        dispute_resolution=order.dispute_resolution,
    )


# The proof photos a buyer sees; the failed drop-off photo is the farm's and
# the admins'.
BUYER_PROOF_KINDS = (order_proof.PACKING, order_proof.DROPOFF)


def _buyer_photo_kinds(db: Session, order_id: int) -> list[str]:
    kinds = {
        kind
        for (kind,) in db.query(OrderProofPhoto.kind).filter(
            OrderProofPhoto.order_id == order_id,
            OrderProofPhoto.kind.in_(BUYER_PROOF_KINDS),
            OrderProofPhoto.object_key.isnot(None),
        )
    }
    return [k for k in BUYER_PROOF_KINDS if k in kinds]


@router.get("/orders/me/{order_id}/proof/{kind}")
def get_my_order_proof_photo(
    order_id: int,
    kind: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The packing or drop-off photo of the buyer's own order (image bytes)."""
    if kind not in BUYER_PROOF_KINDS:
        raise HTTPException(status_code=404, detail="Photo not found")
    rate_limit.enforce_action(db, "proof_view", str(current_user.id))
    owned = (
        db.query(Order.id)
        .filter(Order.id == order_id, Order.user_id == current_user.id)
        .first()
    )
    row = order_proof.get_photo(db, order_id, kind) if owned else None
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found")
    return Response(
        content=order_proof.read_photo(row),
        media_type=row.content_type,
        headers={"Cache-Control": "private, no-store"},
    )


@router.post(
    "/orders/me/{order_id}/dispute-delivery", response_model=OrderDetailResponse
)
def dispute_my_delivery(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ "I did not get this": the farm marked the order delivered, the buyer
    says it did not arrive. Only in the hold after a merchant-set delivery;
    the payout freezes until an admin decides."""
    order = (
        db.query(Order)
        .filter(Order.id == order_id, Order.user_id == current_user.id)
        .with_for_update(of=Order)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    try:
        delivery_dispute.open_dispute(db, order)
    except delivery_dispute.DisputeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    db.commit()
    return get_my_order(order_id, db, current_user)


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
    merchant_set = (
        order.status == OrderStatus.DELIVERED
        and order.delivery_confirmed_by == "merchant"
    )
    if merchant_set and delivery_dispute.is_open(order):
        raise HTTPException(
            status_code=409,
            detail="You reported this order as not received. Carabao is checking it.",
        )
    if merchant_set:
        # The farm marked it delivered with a photo; the buyer's confirm ends
        # the payout hold at once (payout_service.delivery_payable).
        if order.delivery_buyer_confirmed_at is None:
            order.delivery_buyer_confirmed_at = datetime.now(UTC)
        db.commit()
        db.refresh(order)
        return to_current_order_item(order)
    if order.status not in IN_TRANSIT_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot confirm an order that is '{order.status}'",
        )

    mark_delivered(order, confirmed_by="buyer")
    db.commit()
    db.refresh(order)
    return to_current_order_item(order)


@router.post("/orders/me/{order_id}/cancel", response_model=CurrentOrderResponse)
def cancel_my_order(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Buyer cancels a paid order the farm has not shipped yet (CF-0045).

    The stock goes back on sale and the payment goes to the refund queue.
    """
    order = (
        db.query(Order)
        .filter(Order.id == order_id, Order.user_id == current_user.id)
        .with_for_update(of=Order)
        .first()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != OrderStatus.PROCESSING:
        raise HTTPException(
            status_code=409,
            detail="You can cancel an order only before the farm ships it",
        )

    cancel_paid_order(order, db, "You cancelled this order.")
    notifications.notify(
        db,
        notifications.merchant_user_id(order),
        notifications.ORDER_CANCELLED,
        f"Order {notifications.order_ref(order)} was cancelled",
        "The buyer cancelled it before shipping. The stock is back on sale.",
        "/merchantDashboard",
    )
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

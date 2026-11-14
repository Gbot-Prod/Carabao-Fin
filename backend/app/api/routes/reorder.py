"""'Buy again' (U3): put a past order's items back in the cart."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.models.user import User
from app.schemas.cart import CartResponse
from app.services.produce_freshness import is_expired, ph_today
from app.services.produce_pricing import unit_price_for

from ._order_helpers import (
    _extract_item_int,
    _to_int,
    get_or_create_cart,
)

router = APIRouter(tags=["orders"])


class ReorderLine(BaseModel):
    produce_id: int
    name: str
    quantity: int
    price: int
    # Set when stock was lower than the original quantity.
    reduced_from: int | None = None


class ReorderSkip(BaseModel):
    name: str
    reason: str


class ReorderResponse(BaseModel):
    added: list[ReorderLine]
    unavailable: list[ReorderSkip]
    cart: CartResponse


def _merchant_open(merchant: Merchant | None) -> bool:
    return (
        merchant is not None
        and merchant.deleted_at is None
        and (merchant.user is None or merchant.user.suspended_at is None)
    )


@router.post("/orders/me/{order_id}/reorder", response_model=ReorderResponse)
def reorder(
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

    today = ph_today()
    cart = get_or_create_cart(db, current_user.id)
    lines = [dict(i) for i in (cart.items or []) if isinstance(i, dict)]
    by_id = {
        _extract_item_int(line, "produce_id", "produceId", "id"): line for line in lines
    }
    added: list[ReorderLine] = []
    skipped: list[ReorderSkip] = []

    for item in order.items or []:
        if not isinstance(item, dict):
            continue
        produce_id = _extract_item_int(item, "produce_id", "produceId", "id")
        wanted = max(_to_int(item.get("quantity"), 0), 0)
        name = str(item.get("produce") or item.get("name") or "Item")
        produce = db.get(Produce, produce_id) if produce_id else None
        if (
            produce is None
            or produce.hidden_at is not None
            or is_expired(produce, today)
        ):
            skipped.append(ReorderSkip(name=name, reason="no longer available"))
            continue
        name = produce.name or name
        if not _merchant_open(produce.merchant):
            skipped.append(
                ReorderSkip(name=name, reason="the farm isn't taking orders")
            )
            continue
        quantity = max(wanted, produce.min_order_qty or 1)
        if produce.stock_quantity < (produce.min_order_qty or 1):
            skipped.append(ReorderSkip(name=name, reason="out of stock"))
            continue
        reduced_from = None
        if quantity > produce.stock_quantity:
            reduced_from, quantity = quantity, produce.stock_quantity

        existing = by_id.get(produce.id)
        if existing is not None:
            quantity = min(
                max(quantity, _to_int(existing.get("quantity"), 0)),
                produce.stock_quantity,
            )
        price = unit_price_for(produce, quantity)
        merchant = produce.merchant
        line = {
            **(existing or {}),
            "id": str(produce.id),
            "produce_id": produce.id,
            "produce": name,
            "unit": produce.unit,
            "quantity": quantity,
            "price": price,
            "stock_quantity": produce.stock_quantity,
            "min_order_qty": produce.min_order_qty,
            "merchant_id": merchant.id,
            "farm": merchant.merchant_name,
            "delivery_fee": merchant.delivery_price or 0,
        }
        if existing is None:
            lines.append(line)
            by_id[produce.id] = line
        else:
            existing.clear()
            existing.update(line)
        added.append(
            ReorderLine(
                produce_id=produce.id,
                name=name,
                quantity=quantity,
                price=price,
                reduced_from=reduced_from,
            )
        )

    cart.items = lines
    db.commit()
    db.refresh(cart)
    return ReorderResponse(
        added=added, unavailable=skipped, cart=CartResponse.model_validate(cart)
    )

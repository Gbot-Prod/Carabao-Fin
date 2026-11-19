from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db
from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.user import User
from app.schemas.cart import CartResponse, CartUpdate
from app.services.produce_freshness import ph_today
from app.services.produce_pricing import unit_price_for

from ._order_helpers import (
    _extract_item_int,
    _to_int,
    cart_line,
    get_or_create_cart,
    line_problem,
)

router = APIRouter(tags=["carts"])


def _load_produce(db: Session, ids: set[int]) -> dict[int, Produce]:
    return {
        produce.id: produce
        for produce in db.query(Produce)
        .options(selectinload(Produce.merchant).selectinload(Merchant.user))
        .filter(Produce.id.in_(ids))
        .all()
    }


def _stored_quantities(cart: Cart) -> dict[int, int]:
    stored: dict[int, int] = {}
    for item in cart.items or []:
        if not isinstance(item, dict):
            continue
        produce_id = _extract_item_int(item, "produce_id", "produceId", "id")
        if produce_id is not None:
            stored[produce_id] = _to_int(item.get("quantity"), 0)
    return stored


def _build_lines(
    wanted: dict[int, int], produce_by_id: dict[int, Produce], buyer_id: int
) -> list[dict[str, Any]]:
    """Fresh lines from the listings: current price, stock and availability.

    A listing that no longer exists is dropped. Place-order recomputes prices
    the same way, so the cart total matches the charge (CF-0052).
    """
    today = ph_today()
    lines = []
    for produce_id, quantity in wanted.items():
        produce = produce_by_id.get(produce_id)
        if produce is None:
            continue
        lines.append(
            cart_line(
                produce,
                quantity,
                unit_price_for(produce, quantity),
                line_problem(produce, quantity, buyer_id, today),
            )
        )
    return lines


@router.get("/carts/me", response_model=CartResponse)
def get_my_cart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = get_or_create_cart(db, current_user.id)
    stored = _stored_quantities(cart)
    if stored:
        lines = _build_lines(
            stored, _load_produce(db, set(stored)), current_user.id
        )
        if lines != cart.items:
            cart.items = lines
            db.commit()
            db.refresh(cart)
    return cart


@router.put("/carts/me", response_model=CartResponse)
def replace_my_cart(
    cart_update: CartUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = get_or_create_cart(db, current_user.id)

    wanted = {item.produce_id: item.quantity for item in cart_update.items}
    produce_by_id = _load_produce(db, set(wanted))
    missing = sorted(set(wanted) - set(produce_by_id))
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Produce ID {missing[0]} not found"
        )

    # CF-0052: refuse a new or changed line that checkout would refuse. A line
    # already in the cart with the same quantity is kept and flagged instead,
    # so a listing hidden later does not stop the buyer editing the cart.
    stored = _stored_quantities(cart)
    lines = _build_lines(wanted, produce_by_id, current_user.id)
    for line in lines:
        reason = line["unavailable_reason"]
        if reason and stored.get(line["produce_id"]) != line["quantity"]:
            raise HTTPException(
                status_code=400, detail=f"'{line['produce']}' {reason}"
            )

    cart.items = lines
    db.commit()
    db.refresh(cart)
    return cart

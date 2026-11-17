from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db
from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.user import User
from app.schemas.cart import CartItem, CartResponse, CartUpdate
from app.services import money
from app.services.produce_freshness import ph_today
from app.services.produce_pricing import unit_price_for

from ._order_helpers import _to_int, cart_line, cart_line_issue, get_or_create_cart

router = APIRouter(tags=["carts"])


def _live_produce(db: Session, ids: set[int]) -> dict[int, Produce]:
    if not ids:
        return {}
    rows = (
        db.query(Produce)
        .options(selectinload(Produce.merchant).selectinload(Merchant.user))
        .filter(Produce.id.in_(ids))
        .all()
    )
    return {row.id: row for row in rows}


def _cart_response(db: Session, cart: Cart, buyer_id: int) -> CartResponse:
    """The cart as checkout would see it now (CF-0042).

    Each saved line is rebuilt from its live listing (price tier, stock,
    name, farm) and flagged with the reason place-order would refuse it, so
    the buyer learns before checkout. A deleted listing keeps its saved line,
    flagged ``unavailable``. Nothing is written: place-order recomputes all
    of this again under row locks.
    """
    saved = [i for i in (cart.items or []) if isinstance(i, dict)]
    live = _live_produce(db, {_to_int(i.get("produce_id")) for i in saved} - {0})
    today = ph_today()
    items: list[CartItem] = []
    for line in saved:
        quantity = max(_to_int(line.get("quantity")), 0)
        produce = live.get(_to_int(line.get("produce_id")))
        data: dict[str, Any] = dict(line)
        if produce is not None:
            data = cart_line(produce, quantity, unit_price_for(produce, quantity))
            saved_price = line.get("price")
            if isinstance(saved_price, int) and saved_price != data["price"]:
                data["previous_price"] = saved_price
        data["issue"] = cart_line_issue(produce, quantity, buyer_id, today)
        items.append(CartItem.model_validate(data))
    return CartResponse(
        id=cart.id,
        user_id=cart.user_id,
        items=items,
        total_items=sum(i.quantity for i in items),
        total_price=sum(money.line_total(i.price, i.quantity) for i in items),
    )


@router.get("/carts/me", response_model=CartResponse)
def get_my_cart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CartResponse:
    cart = get_or_create_cart(db, current_user.id)
    return _cart_response(db, cart, current_user.id)


@router.put("/carts/me", response_model=CartResponse)
def replace_my_cart(
    cart_update: CartUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CartResponse:
    cart = get_or_create_cart(db, current_user.id)

    wanted = {item.produce_id: item.quantity for item in cart_update.items}
    produce_by_id = _live_produce(db, set(wanted))
    missing = sorted(set(wanted) - set(produce_by_id))
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Produce ID {missing[0]} not found"
        )

    # Saved as sent; lines checkout would refuse come back with an `issue`
    # (CF-0042) instead of failing the save, so the buyer can fix them here.
    cart.items = [
        cart_line(
            produce_by_id[produce_id],
            quantity,
            unit_price_for(produce_by_id[produce_id], quantity),
        )
        for produce_id, quantity in wanted.items()
    ]

    db.commit()
    db.refresh(cart)
    return _cart_response(db, cart, current_user.id)

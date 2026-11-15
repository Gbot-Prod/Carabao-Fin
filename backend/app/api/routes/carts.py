from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.api.dependencies import get_current_user, get_db
from app.models.produce import Produce
from app.models.user import User
from app.schemas.cart import CartResponse, CartUpdate
from app.services.produce_pricing import unit_price_for

from ._order_helpers import cart_line, get_or_create_cart

router = APIRouter(tags=["carts"])


@router.get("/carts/me", response_model=CartResponse)
def get_my_cart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = get_or_create_cart(db, current_user.id)
    return cart


@router.put("/carts/me", response_model=CartResponse)
def replace_my_cart(
    cart_update: CartUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = get_or_create_cart(db, current_user.id)

    wanted = {item.produce_id: item.quantity for item in cart_update.items}
    produce_by_id = {
        produce.id: produce
        for produce in db.query(Produce)
        .options(selectinload(Produce.merchant))
        .filter(Produce.id.in_(wanted))
        .all()
    }
    missing = sorted(set(wanted) - set(produce_by_id))
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Produce ID {missing[0]} not found"
        )

    # Shown in the cart; place-order checks stock and recomputes prices again.
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
    return cart

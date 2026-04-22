from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.cart import CartResponse, CartUpdate

from ._order_helpers import compute_cart_totals, get_or_create_cart

router = APIRouter()


@router.get("/carts/me", response_model=CartResponse)
async def get_my_cart(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = get_or_create_cart(db, current_user.id)
    return cart


@router.put("/carts/me", response_model=CartResponse)
async def replace_my_cart(
    cart_update: CartUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cart = get_or_create_cart(db, current_user.id)
    update_data = cart_update.model_dump(exclude_unset=True)

    if "items" in update_data and update_data["items"] is not None:
        cart.items = update_data["items"]

    total_items, total_price = compute_cart_totals(cart.items or [])
    cart.total_items = total_items
    cart.total_price = total_price

    db.commit()
    db.refresh(cart)
    return cart


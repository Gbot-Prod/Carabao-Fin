from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.produce import Produce
from app.models.user import User
from app.schemas.cart import CartResponse, CartUpdate

from ._order_helpers import get_or_create_cart, _extract_item_int

router = APIRouter(tags=["carts"])


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
        items = update_data["items"]
        for item in items:
            if not isinstance(item, dict):
                continue
            produce_id = _extract_item_int(item, "produce_id", "produceId", "id")
            if produce_id is None:
                continue
            produce = db.query(Produce).filter(Produce.id == produce_id).first()
            if produce is not None:
                item["price"] = produce.price
        cart.items = items

    db.commit()
    db.refresh(cart)
    return cart


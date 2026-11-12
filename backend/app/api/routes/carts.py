from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.produce import Produce
from app.models.user import User
from app.schemas.cart import CartResponse, CartUpdate
from app.services.produce_pricing import unit_price_for

from ._order_helpers import _extract_item_int, _to_int, get_or_create_cart

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
                # Shown in the cart; place-order recomputes both from the listing.
                quantity = _to_int(item.get("quantity"), 0)
                item["price"] = unit_price_for(produce, quantity)
                item["min_order_qty"] = produce.min_order_qty
                # Lets clients group a multi-merchant cart (C1) the way
                # place-order splits it, with each merchant's delivery fee.
                merchant = produce.merchant
                if merchant is not None:
                    item["merchant_id"] = merchant.id
                    item["farm"] = merchant.merchant_name
                    item["delivery_fee"] = merchant.delivery_price or 0
        cart.items = items

    db.commit()
    db.refresh(cart)
    return cart

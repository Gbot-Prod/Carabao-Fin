"""Shared helpers for tests that place buyer orders through /orders/me/place."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders
from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.user import User

ADDRESS = "12 Mabini St, Malolos, Bulacan"


def _client(db: Session, user: User) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _cart(
    db: Session, user: User, merchant: Merchant, price: int = 100, qty: int = 3
) -> Produce:
    produce = Produce(
        merchant_id=merchant.id, name="Talong", price=price, stock_quantity=50
    )
    db.add(produce)
    db.flush()
    cart: Any = db.query(Cart).filter(Cart.user_id == user.id).first()
    if cart is None:
        cart = Cart(user_id=user.id, items=[])
        db.add(cart)
    cart.items = [{"produce_id": produce.id, "quantity": qty}]
    db.commit()
    return produce


def _place(db: Session, user: User) -> Any:
    body = {"delivery_address": ADDRESS}
    return _client(db, user).post("/orders/me/place", json=body)

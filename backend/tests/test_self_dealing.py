"""CF-0040 (B39): merchants can't order from or review their own farm.

Without this a merchant could buy their own produce, confirm delivery as the
buyer, then post a 5-star review and inflate the shop rating.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders
from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.models.review import Review
from app.models.user import User
from app.services.review_service import can_review
from tests import test_reviews as tr
from tests.shared_fixtures import _buyer
from tests.test_merchant_listings import _other_merchant


def _checkout_client(db: Session, user: User) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _produce(db: Session, merchant: Merchant, name: str) -> Produce:
    row = Produce(merchant_id=merchant.id, name=name, price=50, stock_quantity=10)
    db.add(row)
    db.commit()
    return row


def _cart(db: Session, user: User, *produce: Produce) -> None:
    items = [{"produce_id": p.id, "quantity": 1} for p in produce]
    db.add(Cart(user_id=user.id, items=items))
    db.commit()


def test_owner_cannot_order_own_listing_and_nothing_is_placed(
    db: Session, merchant: Merchant
) -> None:
    owner = db.get(User, merchant.user_id)
    assert owner is not None
    rival_item = _produce(db, _other_merchant(db), "Mangga")
    own_item = _produce(db, merchant, "Talong")
    _cart(db, owner, rival_item, own_item)

    resp = _checkout_client(db, owner).post("/orders/me/place", json={})

    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("'Talong' is from your own farm")
    db.rollback()
    assert db.query(Order).count() == 0
    db.expire_all()
    assert db.get(Produce, rival_item.id).stock_quantity == 10  # type: ignore[union-attr]


def test_owner_can_still_order_from_other_farms(
    db: Session, merchant: Merchant
) -> None:
    owner = db.get(User, merchant.user_id)
    assert owner is not None
    rival = _other_merchant(db)
    _cart(db, owner, _produce(db, rival, "Mangga"))

    resp = _checkout_client(db, owner).post("/orders/me/place", json={})

    assert resp.status_code == 200, resp.text
    assert [o["merchant_id"] for o in resp.json()["orders"]] == [rival.id]


def test_other_buyers_can_order_the_listing(db: Session, merchant: Merchant) -> None:
    user, _ = _buyer(db)
    db.commit()
    _cart(db, user, _produce(db, merchant, "Talong"))

    resp = _checkout_client(db, user).post("/orders/me/place", json={})

    assert resp.status_code == 200, resp.text


def test_owner_cannot_review_own_farm_from_an_old_self_order(
    db: Session, merchant: Merchant
) -> None:
    owner = db.get(User, merchant.user_id)
    assert owner is not None
    # A delivered self-order from before checkout refused them.
    order = tr._order(db, merchant, (owner, None))

    assert can_review(order) is False
    resp = tr._client(db, owner).post(
        f"/orders/me/{order.id}/review", json={"rating": 5}
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "You cannot review your own farm"
    assert db.query(Review).count() == 0
    db.refresh(merchant)
    assert merchant.rating_count in (0, None)


def test_buyer_review_unaffected(db: Session, merchant: Merchant) -> None:
    buyer = _buyer(db)
    order = tr._order(db, merchant, buyer)

    resp = tr._client(db, buyer[0]).post(
        f"/orders/me/{order.id}/review", json={"rating": 4}
    )

    assert resp.status_code == 201, resp.text

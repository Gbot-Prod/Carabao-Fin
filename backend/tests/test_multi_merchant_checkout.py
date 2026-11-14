"""C1a: one cart, several merchants, one order per merchant."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders
from app.models.cart import Cart
from app.models.order import Order
from app.models.produce import Produce
from app.models.user import User
from tests.better_auth import set_identity
from tests.test_merchant_listings import _other_merchant
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _produce(db, merchant, name, price, stock=10):  # noqa: F811
    row = Produce(merchant_id=merchant.id, name=name, price=price, stock_quantity=stock)
    db.add(row)
    db.commit()
    return row


def _setup(db, merchant, buyer):  # noqa: F811
    rival = _other_merchant(db)
    merchant.delivery_price = 40
    rival.delivery_price = 25
    talong = _produce(db, merchant, "Talong", 50)
    kamatis = _produce(db, merchant, "Kamatis", 30)
    mangga = _produce(db, rival, "Mangga", 100, stock=3)
    db.add(
        Cart(
            user_id=buyer[0].id,
            items=[
                {"produce_id": mangga.id, "quantity": 2},
                {"produce_id": talong.id, "quantity": 2},
                {"produceId": kamatis.id, "quantity": 1},
            ],
        )
    )
    db.commit()
    return rival, talong, kamatis, mangga


def test_one_order_per_merchant_with_each_delivery_fee(db, merchant, buyer):  # noqa: F811
    rival, talong, kamatis, mangga = _setup(db, merchant, buyer)

    resp = _client(db, buyer[0]).post(
        "/orders/me/place",
        json={"delivery_address": "12 Mabini St, Malolos, Bulacan", "notes": "Gate 2"},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    placed = body["orders"]
    assert [o["merchant_id"] for o in placed] == sorted([merchant.id, rival.id])
    by_merchant = {o["merchant_id"]: o for o in placed}
    assert by_merchant[merchant.id]["total_price"] == 50 * 2 + 30 + 40
    assert by_merchant[merchant.id]["delivery_fee"] == 40
    assert by_merchant[rival.id]["total_price"] == 100 * 2 + 25
    assert by_merchant[rival.id]["merchant_name"] == "Other Farm"
    # Old single-order fields point at the first order.
    assert body["order_id"] == placed[0]["order_id"]
    assert body["order_reference"] == placed[0]["order_reference"]

    stored = {o.merchant_id: o for o in db.query(Order).all()}
    assert len(stored) == 2
    assert {i["price"] for i in stored[merchant.id].items} == {50, 30}
    assert [i["quantity"] for i in stored[rival.id].items] == [2]
    assert all(o.notes == "Gate 2" and o.status == "pending" for o in stored.values())
    db.expire_all()
    assert db.get(Produce, talong.id).stock_quantity == 8
    assert db.get(Produce, mangga.id).stock_quantity == 1


def test_any_problem_places_no_orders(db, merchant, buyer):  # noqa: F811
    _, talong, _, mangga = _setup(db, merchant, buyer)
    mangga.stock_quantity = 1  # cart wants 2
    db.commit()

    resp = _client(db, buyer[0]).post("/orders/me/place", json={})

    assert resp.status_code == 400
    assert "Insufficient stock for 'Mangga'" in resp.json()["detail"]
    db.rollback()
    assert db.query(Order).count() == 0
    assert db.get(Produce, talong.id).stock_quantity == 10


def test_suspended_merchant_in_cart_blocks_checkout_and_names_them(db, merchant, buyer):  # noqa: F811

    rival, *_ = _setup(db, merchant, buyer)
    set_identity(db, db.get(User, rival.user_id), banned=True)
    db.commit()

    resp = _client(db, buyer[0]).post("/orders/me/place", json={})

    assert resp.status_code == 400
    assert resp.json()["detail"].startswith("Other Farm is no longer accepting orders")
    db.rollback()
    assert db.query(Order).count() == 0


def test_single_merchant_cart_still_gets_one_order(db, merchant, buyer):  # noqa: F811
    talong = _produce(db, merchant, "Talong", 50)
    db.add(Cart(user_id=buyer[0].id, items=[{"produce_id": talong.id, "quantity": 1}]))
    db.commit()

    body = _client(db, buyer[0]).post("/orders/me/place", json={}).json()

    assert len(body["orders"]) == 1
    assert body["orders"][0]["order_id"] == body["order_id"]

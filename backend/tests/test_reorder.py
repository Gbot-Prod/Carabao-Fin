"""U3: 'Buy again' refills the cart and says what couldn't be added."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import reorder
from app.models.cart import Cart
from app.models.order import Order
from app.models.produce import Produce
from app.models.user import User
from app.services.produce_freshness import ph_today
from tests.better_auth import set_identity
from tests.test_merchant_listings import _other_merchant
from tests.test_reviews import _buyer, buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(reorder.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def past_order(db, merchant, buyer):  # noqa: F811
    rival = _other_merchant(db)
    today = ph_today()
    rows = {
        "talong": Produce(
            merchant_id=merchant.id, name="Talong", price=50, stock_quantity=10
        ),
        "short": Produce(
            merchant_id=merchant.id, name="Kamatis", price=40, stock_quantity=2
        ),
        "empty": Produce(
            merchant_id=merchant.id, name="Sibuyas", price=90, stock_quantity=0
        ),
        "expired": Produce(
            merchant_id=merchant.id,
            name="Old Pechay",
            price=20,
            stock_quantity=9,
            best_before=today - timedelta(1),
        ),
        "hidden": Produce(
            merchant_id=merchant.id,
            name="Hidden",
            price=20,
            stock_quantity=9,
            hidden_at=datetime.now(UTC),
        ),
        "closed": Produce(
            merchant_id=rival.id, name="Mangga", price=150, stock_quantity=9
        ),
        "bulk": Produce(
            merchant_id=merchant.id,
            name="Repolyo",
            price=60,
            stock_quantity=20,
            min_order_qty=5,
        ),
    }
    db.add_all(rows.values())
    db.flush()
    set_identity(db, db.get(User, rival.user_id), banned=True)
    user, _ = buyer
    items = [
        {"produce_id": rows["talong"].id, "produce": "Talong", "quantity": 3},
        {"produce_id": rows["short"].id, "produce": "Kamatis", "quantity": 5},
        {"produce_id": rows["empty"].id, "produce": "Sibuyas", "quantity": 1},
        {"produce_id": rows["expired"].id, "produce": "Old Pechay", "quantity": 1},
        {"produce_id": rows["hidden"].id, "produce": "Hidden", "quantity": 1},
        {"produce_id": rows["closed"].id, "produce": "Mangga", "quantity": 1},
        {"produce_id": rows["bulk"].id, "produce": "Repolyo", "quantity": 2},
        {"produce_id": 9999, "produce": "Deleted thing", "quantity": 1},
    ]
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status="delivered",
        total_price=500,
        items=items,
    )
    db.add(order)
    db.commit()
    return order, rows


def test_reorder_adds_available_items_and_lists_the_rest(db, buyer, past_order):  # noqa: F811
    order, rows = past_order
    res = _client(db, buyer[0]).post(f"/orders/me/{order.id}/reorder")
    assert res.status_code == 200, res.text
    body = res.json()

    added = {a["name"]: a for a in body["added"]}
    assert added["Talong"]["quantity"] == 3 and added["Talong"]["reduced_from"] is None
    assert added["Kamatis"]["quantity"] == 2 and added["Kamatis"]["reduced_from"] == 5
    assert added["Repolyo"]["quantity"] == 5  # raised to the new minimum order
    skipped = {s["name"]: s["reason"] for s in body["unavailable"]}
    assert skipped == {
        "Sibuyas": "out of stock",
        "Old Pechay": "no longer available",
        "Hidden": "no longer available",
        "Mangga": "the farm isn't taking orders",
        "Deleted thing": "no longer available",
    }

    cart = db.query(Cart).filter(Cart.user_id == buyer[0].id).one()
    lines = {line["produce"]: line for line in cart.items}
    assert set(lines) == {"Talong", "Kamatis", "Repolyo"}
    assert (
        lines["Talong"]["price"] == 50 and lines["Talong"]["farm"] == "Dela Cruz Farm"
    )
    assert lines["Talong"]["id"] == str(rows["talong"].id)


def test_reorder_merges_with_what_is_already_in_the_cart(db, buyer, past_order):  # noqa: F811
    order, rows = past_order
    db.add(
        Cart(
            user_id=buyer[0].id,
            items=[
                {
                    "id": str(rows["talong"].id),
                    "produce": "Talong",
                    "quantity": 7,
                    "price": 50,
                },
            ],
        )
    )
    db.commit()
    _client(db, buyer[0]).post(f"/orders/me/{order.id}/reorder")
    cart = db.query(Cart).filter(Cart.user_id == buyer[0].id).one()
    talong = [line for line in cart.items if line["produce"] == "Talong"]
    assert len(talong) == 1 and talong[0]["quantity"] == 7


def test_only_your_own_orders(db, past_order):  # noqa: F811
    order, _ = past_order
    stranger, _ = _buyer(db, email="stranger@example.com")
    assert (
        _client(db, stranger).post(f"/orders/me/{order.id}/reorder").status_code == 404
    )

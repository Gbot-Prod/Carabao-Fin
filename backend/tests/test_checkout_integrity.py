"""CF-0039 / CF-0047 / CF-0052: own-farm orders, re-checkout, cart validation."""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import carts, orders, reviews
from app.models.cart import Cart
from app.models.order import Order
from app.models.produce import Produce
from app.models.transaction import Transaction
from app.services import order_reservations
from tests.test_merchant_listings import _other_merchant

ADDRESS = {"delivery_address": "12 Mabini St, Malolos, Bulacan"}


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.include_router(carts.router)
    app.include_router(reviews.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _produce(db, merchant, name="Talong", price=50, stock=10, **extra):
    row = Produce(
        merchant_id=merchant.id,
        name=name,
        price=price,
        stock_quantity=stock,
        **extra,
    )
    db.add(row)
    db.commit()
    return row


def _put(client, *lines):
    return client.put(
        "/carts/me",
        json={"items": [{"produce_id": p.id, "quantity": q} for p, q in lines]},
    )


# CF-0047 ---------------------------------------------------------------------


def test_second_checkout_replaces_the_unpaid_order(db, merchant, buyer):
    user, _ = buyer
    talong = _produce(db, merchant)
    client = _client(db, user)
    assert _put(client, (talong, 3)).status_code == 200

    first = client.post("/orders/me/place", json=ADDRESS)
    second = client.post("/orders/me/place", json=ADDRESS)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    db.expire_all()
    old = db.get(Order, first.json()["order_id"])
    new = db.get(Order, second.json()["order_id"])
    assert old.status == "cancelled"
    assert new.status == "pending"
    # Held once, not twice.
    assert db.get(Produce, talong.id).stock_quantity == 7


def test_unrelated_unpaid_order_is_kept(db, merchant, buyer):
    user, _ = buyer
    rival = _other_merchant(db)
    talong = _produce(db, merchant)
    mangga = _produce(db, rival, "Mangga", 100)
    client = _client(db, user)
    _put(client, (talong, 1), (mangga, 1))

    first = client.post(
        "/orders/me/place", json={**ADDRESS, "produce_ids": [talong.id]}
    )
    second = client.post(
        "/orders/me/place", json={**ADDRESS, "produce_ids": [mangga.id]}
    )

    assert first.status_code == 200 and second.status_code == 200
    db.expire_all()
    assert db.get(Order, first.json()["order_id"]).status == "pending"


def test_checkout_waits_while_old_payment_is_in_progress(
    db, merchant, buyer, monkeypatch
):
    user, _ = buyer
    talong = _produce(db, merchant)
    client = _client(db, user)
    _put(client, (talong, 2))
    first = client.post("/orders/me/place", json=ADDRESS).json()["order_id"]
    db.add(
        Transaction(
            order_id=first,
            merchant_id=merchant.id,
            user_id=user.id,
            amount=150,
            platform_fee=10,
            merchant_amount=140,
            status="pending",
            paymongo_session_id="cs_live",
        )
    )
    db.commit()
    monkeypatch.setattr(
        order_reservations, "expire_checkout_session", lambda _sid: False
    )

    res = client.post("/orders/me/place", json=ADDRESS)

    assert res.status_code == 409
    db.expire_all()
    assert db.get(Order, first).status == "pending"
    assert db.query(Order).count() == 1


# CF-0039 ---------------------------------------------------------------------


def test_merchant_cannot_add_or_order_own_produce(db, merchant):
    owner = merchant.user
    talong = _produce(db, merchant)
    client = _client(db, owner)

    res = _put(client, (talong, 1))
    assert res.status_code == 400
    assert "your own farm" in res.json()["detail"]

    # A line already stored (e.g. before this rule) still fails checkout.
    cart = db.query(Cart).filter_by(user_id=owner.id).one()
    cart.items = [{"produce_id": talong.id, "quantity": 1}]
    db.commit()
    res = client.post("/orders/me/place", json=ADDRESS)
    assert res.status_code == 400
    assert "your own farm" in res.json()["detail"]


def test_merchant_cannot_review_own_farm(db, merchant):
    owner = merchant.user
    order = Order(
        user_id=owner.id,
        merchant_id=merchant.id,
        status="delivered",
        total_price=100,
        items=[],
        delivered_at=datetime.now(UTC) - timedelta(hours=1),
    )
    db.add(order)
    db.commit()

    res = _client(db, owner).post(
        f"/orders/me/{order.id}/review", json={"rating": 5}
    )
    assert res.status_code == 403


# CF-0052 ---------------------------------------------------------------------


def test_cart_refuses_lines_checkout_would_refuse(db, merchant, buyer):
    user, _ = buyer
    hidden = _produce(db, merchant, "Hidden", hidden_at=datetime.now(UTC))
    bulk = _produce(db, merchant, "Repolyo", min_order_qty=5)
    client = _client(db, user)

    assert _put(client, (hidden, 1)).status_code == 400
    res = _put(client, (bulk, 2))
    assert res.status_code == 400
    assert "minimum order of 5" in res.json()["detail"]
    assert _put(client, (bulk, 5)).status_code == 200


def test_line_that_goes_bad_is_kept_and_flagged(db, merchant, buyer):
    user, _ = buyer
    talong = _produce(db, merchant)
    kamatis = _produce(db, merchant, "Kamatis", 30)
    client = _client(db, user)
    assert _put(client, (talong, 2)).status_code == 200

    talong.hidden_at = datetime.now(UTC)
    db.commit()

    # The buyer can still edit other lines.
    res = _put(client, (talong, 2), (kamatis, 1))
    assert res.status_code == 200, res.text
    flagged = {i["produce"]: i["unavailable_reason"] for i in res.json()["items"]}
    assert flagged == {"Talong": "is no longer available", "Kamatis": None}
    # Changing the bad line's quantity is refused.
    assert _put(client, (talong, 3), (kamatis, 1)).status_code == 400


def test_cart_read_shows_current_price(db, merchant, buyer):
    user, _ = buyer
    talong = _produce(db, merchant, price=50)
    client = _client(db, user)
    _put(client, (talong, 2))

    talong.price = 65
    db.commit()

    body = client.get("/carts/me").json()
    assert body["items"][0]["price"] == 65
    assert body["total_price"] == 130

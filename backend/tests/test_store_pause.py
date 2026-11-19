"""CF-0066 (B13): a farm pauses orders until a date (holiday mode)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants, reorder
from app.api.routes._order_helpers import merchant_takes_orders
from app.models.order import Order
from app.models.produce import Produce
from app.services import store_pause
from app.services.produce_freshness import ph_today
from tests.shared_fixtures import _buyer
from tests.test_merchant_orders import _merchant_client
from tests.test_vouchers import _cart, _place

URL = "/merchants/me/pause"


def test_owner_pauses_and_resumes(db: Session, merchant: Any) -> None:
    client = _merchant_client(db, merchant)
    until = ph_today() + timedelta(days=7)

    res = client.put(
        URL, json={"paused_until": until.isoformat(), "message": " Harvest break "}
    )
    assert res.status_code == 200, res.text
    assert (res.json()["paused_until"], res.json()["pause_message"]) == (
        until.isoformat(),
        "Harvest break",
    )
    public = client.get(f"/merchants/{merchant.id}").json()
    assert public["paused_until"] == until.isoformat()
    assert public["pause_message"] == "Harvest break"
    listed = client.get("/merchants", params={"include_produce": "false"}).json()
    assert listed[0]["paused_until"] == until.isoformat()  # still listed

    res = client.delete(URL)
    assert res.status_code == 200
    assert res.json()["paused_until"] is None and res.json()["pause_message"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"paused_until": (ph_today() - timedelta(days=1)).isoformat()},
        {
            "paused_until": (
                ph_today() + timedelta(days=store_pause.MAX_PAUSE_DAYS + 1)
            ).isoformat()
        },
        {"paused_until": ph_today().isoformat(), "message": "x" * 201},
        {"paused_until": ph_today().isoformat(), "user_id": 1},
        {"paused_until": "not a date"},
        {},
    ],
)
def test_bad_pause_is_refused(db: Session, merchant: Any, body: dict[str, Any]) -> None:
    res = _merchant_client(db, merchant).put(URL, json=body)
    assert res.status_code == 422, (body, res.text)
    db.refresh(merchant)
    assert merchant.paused_until is None


def test_no_farm_gets_404(db: Session) -> None:
    user, _ = _buyer(db, "plain@example.com")
    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    assert (
        client.put(URL, json={"paused_until": ph_today().isoformat()}).status_code
        == 404
    )
    assert client.delete(URL).status_code == 404


def test_checkout_refuses_a_paused_farm_until_the_day_after(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    produce: Any = _cart(db, user, merchant)
    merchant.paused_until = ph_today()  # paused through today
    db.commit()

    res = _place(db, user, None)
    assert res.status_code == 400
    assert "on a break" in res.json()["detail"]
    db.rollback()
    assert db.query(Order).count() == 0
    assert db.get(Produce, produce.id).stock_quantity == 50  # type: ignore[union-attr]

    merchant.paused_until = ph_today() - timedelta(days=1)  # the break is over
    db.commit()
    assert _place(db, user, None).status_code == 200


def test_takes_orders_and_reorder_follow_the_pause(
    db: Session, merchant: Any, buyer: Any
) -> None:
    today = ph_today()
    merchant.paused_until = today + timedelta(days=2)
    db.commit()
    assert merchant_takes_orders(merchant) is False
    assert store_pause.is_paused(merchant, today + timedelta(days=2)) is True
    assert store_pause.is_paused(merchant, today + timedelta(days=3)) is False

    user = buyer[0]
    produce: Any = Produce(
        merchant_id=merchant.id, name="Talong", price=100, stock_quantity=50
    )
    db.add(produce)
    db.flush()
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status="delivered",
        total_price=100,
        items=[{"produce_id": produce.id, "quantity": 1, "price": 100}],
    )
    db.add(order)
    db.commit()
    app = FastAPI()
    app.include_router(reorder.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    res = TestClient(app).post(f"/orders/me/{order.id}/reorder")
    assert res.status_code == 200, res.text
    assert [s["reason"] for s in res.json()["unavailable"]] == [
        "the farm is on a break"
    ]

"""Which orders a merchant may put on a shipment, and the shipment list summary."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import shipments
from app.models.order import Order
from app.models.shipment import Shipment
from app.models.user import User
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, merchant) -> TestClient:
    app = FastAPI()
    app.include_router(shipments.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, merchant.user_id)
    return TestClient(app)


def _order(db, merchant, buyer, status, shipment_id=None):
    user, history = buyer
    order = Order(
        order_history_id=history.id,
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=500,
        items=[],
        delivery_address="123 Rizal St., Malolos",
        shipment_id=shipment_id,
    )
    db.add(order)
    db.commit()
    return order


def _shipment(db, merchant, stop_count):
    shipment = Shipment(merchant_id=merchant.id, stop_count=stop_count, route_waypoints=[])
    db.add(shipment)
    db.commit()
    return shipment


@pytest.mark.parametrize(
    "status",
    ["pending", "shipped", "out_for_delivery", "delivered", "cancelled"],
)
def test_only_processing_orders_can_ship(db, merchant, buyer, status):  # noqa: F811
    order = _order(db, merchant, buyer, status)

    resp = _client(db, merchant).post(
        "/merchants/me/shipments", json={"order_ids": [order.id]}
    )

    assert resp.status_code == 400
    assert str(order.id) in resp.json()["detail"]


def test_order_already_in_a_shipment_is_rejected(db, merchant, buyer):  # noqa: F811
    existing = _shipment(db, merchant, stop_count=1)
    order = _order(db, merchant, buyer, "processing", shipment_id=existing.id)

    resp = _client(db, merchant).post(
        "/merchants/me/shipments", json={"order_ids": [order.id]}
    )

    assert resp.status_code == 400


def test_mixed_batch_names_every_ineligible_order(db, merchant, buyer):  # noqa: F811
    ok = _order(db, merchant, buyer, "processing")
    unpaid = _order(db, merchant, buyer, "pending")
    on_road = _order(db, merchant, buyer, "out_for_delivery")

    resp = _client(db, merchant).post(
        "/merchants/me/shipments", json={"order_ids": [ok.id, unpaid.id, on_road.id]}
    )

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail.endswith(f"{unpaid.id}, {on_road.id}")
    assert db.query(Shipment).count() == 0


def test_shipment_list_counts_completed_stops(db, merchant, buyer):  # noqa: F811
    done = _shipment(db, merchant, stop_count=2)
    _order(db, merchant, buyer, "delivered", shipment_id=done.id)
    _order(db, merchant, buyer, "cancelled", shipment_id=done.id)

    active = _shipment(db, merchant, stop_count=2)
    _order(db, merchant, buyer, "delivered", shipment_id=active.id)
    _order(db, merchant, buyer, "out_for_delivery", shipment_id=active.id)

    empty = _shipment(db, merchant, stop_count=1)

    rows = {s["id"]: s for s in _client(db, merchant).get("/merchants/me/shipments").json()}

    assert rows[done.id]["completed_stop_count"] == 2
    assert rows[active.id]["completed_stop_count"] == 1
    assert rows[empty.id]["completed_stop_count"] == 0

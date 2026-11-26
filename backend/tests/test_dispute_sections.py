"""The disputes lists (admin and merchant) and the farm's side of a dispute."""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders
from app.models.order import Order
from app.models.user import User
from app.services import order_retention
from tests.test_admin_orders import _admin
from tests.test_admin_orders import _client as _admin_client
from tests.test_delivery_dispute import _buyer_client, _merchant_delivered
from tests.test_merchant_listings import _other_merchant


def _farm_client(db, merchant) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, merchant.user_id)
    return TestClient(app)


def _disputed(db, merchant, buyer, flags=None):
    order = _merchant_delivered(db, merchant, buyer, flags=flags)
    resp = _buyer_client(db, buyer).post(f"/orders/me/{order.id}/dispute-delivery")
    assert resp.status_code == 200, resp.text
    return order


def test_farm_sees_its_disputes_and_adds_its_side(db, merchant, buyer):
    order = _disputed(db, merchant, buyer)
    farm = _farm_client(db, merchant)

    listed = farm.get("/orders/merchant/disputes")
    assert listed.status_code == 200, listed.text
    [row] = listed.json()
    assert row["order_id"] == order.id
    assert row["open"] is True
    assert row["merchant_note"] is None

    blank = farm.put(f"/orders/merchant/{order.id}/dispute-note", json={"note": "  "})
    assert blank.status_code == 422
    res = farm.put(
        f"/orders/merchant/{order.id}/dispute-note",
        json={"note": " Left with the guard at 3 pm "},
    )
    assert res.status_code == 200, res.text
    assert res.json()["merchant_note"] == "Left with the guard at 3 pm"

    detail = _admin_client(db, _admin(db)).get(f"/admin/orders/{order.id}").json()
    assert detail["delivery"]["dispute_merchant_note"] == "Left with the guard at 3 pm"


def test_farm_cannot_change_its_side_after_the_decision(db, merchant, buyer):
    order = _disputed(db, merchant, buyer)
    _admin_client(db, _admin(db)).post(
        f"/admin/orders/{order.id}/dispute", json={"decision": "release"}
    )
    res = _farm_client(db, merchant).put(
        f"/orders/merchant/{order.id}/dispute-note", json={"note": "Late reply"}
    )
    assert res.status_code == 409
    [row] = _farm_client(db, merchant).get("/orders/merchant/disputes").json()
    assert row["open"] is False
    assert row["resolution"] == "release"


def test_farm_cannot_see_or_answer_another_farms_dispute(db, merchant, buyer):
    order = _disputed(db, merchant, buyer)
    other = _other_merchant(db)
    farm = _farm_client(db, other)
    assert farm.get("/orders/merchant/disputes").json() == []
    res = farm.put(f"/orders/merchant/{order.id}/dispute-note", json={"note": "x"})
    assert res.status_code == 404


def test_admin_lists_open_and_decided_disputes(db, merchant, buyer):
    first = _disputed(db, merchant, buyer, flags=["gps_far"])
    second = _disputed(db, merchant, buyer)
    _merchant_delivered(db, merchant, buyer)  # not disputed
    client = _admin_client(db, _admin(db))

    open_page = client.get("/admin/disputes").json()
    assert open_page["total"] == 2
    assert [d["order_id"] for d in open_page["items"]] == [first.id, second.id]
    assert open_page["items"][0]["delivery_flagged"] is True
    assert open_page["items"][0]["merchant_name"] == "Dela Cruz Farm"

    client.post(f"/admin/orders/{first.id}/dispute", json={"decision": "refund"})
    assert client.get("/admin/disputes").json()["total"] == 1
    decided = client.get("/admin/disputes", params={"state": "decided"}).json()
    assert [d["order_id"] for d in decided["items"]] == [first.id]
    assert decided["items"][0]["resolution"] == "refund"
    assert client.get("/admin/disputes", params={"state": "x"}).status_code == 422


def test_non_admin_cannot_list_disputes(db, merchant, buyer):
    assert _admin_client(db, buyer[0]).get("/admin/disputes").status_code == 403


def test_retention_keeps_an_open_dispute(db, merchant, buyer):
    order = _disputed(db, merchant, buyer)
    order.closed_at = datetime.now(UTC) - timedelta(days=30)
    order.delivery_address = "Purok 1"
    order.dispute_merchant_note = "Left at the gate"
    db.commit()

    assert order_retention.purge_closed_order_details(db, 14) == 0
    order.dispute_resolution = "release"
    db.commit()
    assert order_retention.purge_closed_order_details(db, 14) == 1
    db.commit()
    db.expire_all()
    stored = db.get(Order, order.id)
    assert stored.delivery_address is None
    assert stored.dispute_merchant_note is None

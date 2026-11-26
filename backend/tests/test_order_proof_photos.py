"""Order proof photos (documentation/plans/ORDER_PROOF_PHOTOS_PLAN.md, Phase 1)."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants, shipments
from app.models.order import Order
from app.models.order_proof_photo import OrderProofPhoto
from app.models.statuses import OrderStatus
from app.models.user import User
from app.services import payout_service, r2_service
from tests.files import png_bytes
from tests.test_merchant_orders import _scheduled_order

PIN = (14.8433, 120.8114)  # the buyer pin of every order here
NEAR = (14.8434, 120.8115)  # about 15 m away
FAR = (14.8533, 120.8114)  # about 1.1 km away


@pytest.fixture
def client(db, merchant, monkeypatch):
    monkeypatch.setattr(
        r2_service,
        "upload_proof_photo",
        lambda order_id, kind, f: f"proof/{order_id}/{kind}/k",
    )
    monkeypatch.setattr(r2_service, "delete_private_document", lambda key: None)
    monkeypatch.setattr(merchants, "_compute_and_store_route", lambda db, order: None)
    app = FastAPI()
    app.include_router(merchants.router)
    app.include_router(shipments.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, merchant.user_id)
    return TestClient(app)


def _order(db, merchant, buyer, status=OrderStatus.PROCESSING, **fields):
    order = _scheduled_order(db, merchant, buyer)
    order.status = status
    order.delivery_lat, order.delivery_lng = PIN
    order.shipped_at = datetime.now(UTC) - timedelta(hours=1)
    for name, value in fields.items():
        setattr(order, name, value)
    db.commit()
    return order


def _photo(color: int = 0) -> dict:
    # A different size gives different bytes, so a different SHA-256.
    return {"photo": ("p.png", png_bytes((8 + color, 8)), "image/png")}


def _deliver(client, order, position=None, color=0):
    data = {"lat": str(position[0]), "lng": str(position[1])} if position else {}
    return client.post(
        f"/merchants/me/orders/{order.id}/deliver", files=_photo(color), data=data
    )


def test_ship_is_refused_without_a_packing_photo(client, db, merchant, buyer):
    order = _order(db, merchant, buyer)

    patch = client.patch(
        f"/merchants/me/orders/{order.id}/status", json={"status": "shipped"}
    )
    route = client.post("/merchants/me/shipments", json={"order_ids": [order.id]})

    assert patch.status_code == 409
    assert "merchant app" in patch.json()["detail"]
    assert route.status_code == 409
    assert str(order.id) in route.json()["detail"]
    db.expire_all()
    assert db.get(Order, order.id).status == OrderStatus.PROCESSING


def test_ship_with_a_photo_ships_and_keeps_the_photo(client, db, merchant, buyer):
    order = _order(db, merchant, buyer, shipped_at=None)

    resp = client.post(f"/merchants/me/orders/{order.id}/ship", files=_photo())

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "shipped"
    assert resp.json()["packing_photo"] is True
    row = db.query(OrderProofPhoto).filter_by(order_id=order.id).one()
    assert row.kind == "packing" and len(row.sha256) == 64


def test_deliver_near_the_pin_has_no_flags(client, db, merchant, buyer):
    order = _order(db, merchant, buyer, OrderStatus.OUT_FOR_DELIVERY)

    resp = _deliver(client, order, NEAR)

    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "delivered"
    db.expire_all()
    assert db.get(Order, order.id).delivery_confirmed_by == "merchant"
    row = db.query(OrderProofPhoto).filter_by(order_id=order.id).one()
    assert row.flags == [] and row.distance_m < 200


def test_deliver_sets_far_missing_and_reused_flags(client, db, merchant, buyer):
    far = _order(db, merchant, buyer, OrderStatus.SHIPPED)
    no_gps = _order(db, merchant, buyer, OrderStatus.SHIPPED)
    reused = _order(db, merchant, buyer, OrderStatus.SHIPPED)

    assert _deliver(client, far, FAR, color=1).status_code == 200
    assert _deliver(client, no_gps, None, color=2).status_code == 200
    assert _deliver(client, reused, NEAR, color=1).status_code == 200  # far's file

    flags = {row.order_id: row.flags for row in db.query(OrderProofPhoto).all()}
    assert flags[far.id] == ["gps_far"]
    assert flags[no_gps.id] == ["gps_missing"]
    assert flags[reused.id] == ["hash_reused"]
    # No raw position is kept: only the distance.
    assert not hasattr(OrderProofPhoto, "lat")


def _delivered(hours_ago: float, **fields):
    now = datetime.now(UTC)
    return SimpleNamespace(
        delivery_confirmed_by="merchant",
        delivered_at=now - timedelta(hours=hours_ago),
        shipped_at=now - timedelta(hours=hours_ago + 1),
        delivery_buyer_confirmed_at=None,
        delivery_disputed_at=None,
        dispute_resolution=None,
        **fields,
    )


def test_payout_hold_is_48_hours_for_an_unflagged_delivery(monkeypatch):
    monkeypatch.setattr(payout_service, "BUYER_DISPUTES_LIVE", True)

    assert not payout_service.delivery_payable(_delivered(47), [])
    assert payout_service.delivery_payable(_delivered(49), [])
    # An open dispute freezes it.
    disputed = _delivered(49)
    disputed.delivery_disputed_at = datetime.now(UTC)
    assert not payout_service.delivery_payable(disputed, [])


def test_flagged_delivery_is_not_payable_early(monkeypatch):
    monkeypatch.setattr(payout_service, "BUYER_DISPUTES_LIVE", True)

    assert not payout_service.delivery_payable(_delivered(49), ["gps_far"])
    # From the auto-confirm time (7 days from shipping) it is payable.
    assert payout_service.delivery_payable(_delivered(24 * 7), ["gps_far"])
    # The buyer's confirm ends the hold at once.
    confirmed = _delivered(1)
    confirmed.delivery_buyer_confirmed_at = datetime.now(UTC)
    assert payout_service.delivery_payable(confirmed, ["gps_far"])


def test_with_disputes_off_every_merchant_delivery_waits_for_auto_confirm(
    monkeypatch,
):
    # The switch off: buyers cannot dispute, so no 48 h early payout.
    monkeypatch.setattr(payout_service, "BUYER_DISPUTES_LIVE", False)
    assert not payout_service.delivery_payable(_delivered(49), [])

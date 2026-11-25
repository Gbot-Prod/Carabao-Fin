"""Pin quality, phase 3: pins saved during a road-service outage are checked
again later (item 4), and only the server sets a pin to verified (item 5)."""

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import shipments, user_addresses
from app.models.order import Order
from app.models.order_proof_photo import OrderProofPhoto
from app.models.statuses import OrderStatus
from app.models.user import User
from app.models.user_address import UserAddress
from app.services import pinned_location, road_snap
from app.services.order_status import mark_delivered

MALOLOS = (14.8433, 120.8114)
ROAD = (14.8436, 120.8117)
FAR = (14.8533, 120.8114)  # ~1.1 km north


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self.ok = 200 <= status < 300
        self._body = body

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def _fresh_cache():
    road_snap.clear_cache()
    yield
    road_snap.clear_cache()


def _road_service(monkeypatch, handler):
    monkeypatch.setenv("ROAD_SNAP_PROVIDER", "mapbox")
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.test")
    monkeypatch.setattr(road_snap._requests, "get", lambda *a, **k: handler())


def _down():
    raise road_snap._requests.exceptions.ConnectionError("down")


def _road():
    return _Resp(
        200,
        {
            "code": "Ok",
            "waypoints": [{"location": [ROAD[1], ROAD[0]], "distance": 35.0}],
        },
    )


def _no_road():
    return _Resp(422, {"code": "NoSegment"})


def _client(db, user, *routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _order(db, merchant, user, status=OrderStatus.PROCESSING, pin=MALOLOS, **extra):
    extra.setdefault("delivery_address", "123 Rizal St., Malolos")
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=100,
        items=[],
        delivery_lat=pin[0] if pin else None,
        delivery_lng=pin[1] if pin else None,
        **extra,
    )
    db.add(order)
    db.commit()
    return order


# --- Item 4: road not checked -----------------------------------------------


def test_outage_pin_is_saved_without_road_and_rechecked(db, buyer, monkeypatch):
    user = buyer[0]
    _road_service(monkeypatch, _down)
    me = _client(db, user, user_addresses.router)
    res = me.post("/users/me/addresses", json={"lat": MALOLOS[0], "lng": MALOLOS[1]})
    assert res.status_code == 201, res.text
    address = db.get(UserAddress, res.json()["id"])
    assert pinned_location.needs_road_check(address)

    # Still down: nothing changes, and the result says "no answer".
    assert pinned_location.recheck_roads([(address, "")]) == [None]
    assert address.road_lat is None

    _road_service(monkeypatch, _road)
    [result] = pinned_location.recheck_roads([(address, "")])
    assert isinstance(result, road_snap.Snap)
    assert (address.road_lat, address.road_lng) == ROAD
    assert not pinned_location.needs_road_check(address)


def test_recheck_skips_checked_pins_and_empty_targets(monkeypatch):
    calls = []
    _road_service(monkeypatch, lambda: calls.append(1) or _road())

    class Row:
        lat, lng, road_lat, road_lng = MALOLOS[0], MALOLOS[1], ROAD[0], ROAD[1]

    class NoPin:
        lat = lng = road_lat = road_lng = None

    assert pinned_location.recheck_roads([(Row(), ""), (NoPin(), ""), None]) == [
        None,
        None,
        None,
    ]
    assert calls == []


def test_shipment_rechecks_outage_pins_and_warns_on_no_road(
    db, merchant, buyer, monkeypatch
):
    user = buyer[0]
    merchant.lat, merchant.lng = MALOLOS
    good = _order(db, merchant, user)
    bad = _order(db, merchant, user, pin=FAR)
    # A route takes only orders with a packing photo (order_proof).
    for order in (good, bad):
        db.add(
            OrderProofPhoto(
                order_id=order.id,
                kind="packing",
                sha256=f"{order.id:064x}",
                content_type="image/jpeg",
                flags=[],
            )
        )
    db.commit()
    monkeypatch.setattr(shipments, "_get_leg_durations", lambda coords: None)
    monkeypatch.setattr(
        shipments,
        "_get_duration_matrix",
        lambda coords: [[0 if i == j else 60 for j in coords] for i in coords],
    )

    def snap(lat, lng):
        return road_snap.NO_ROAD if (lat, lng) == FAR else road_snap.Snap(ROAD, 35.0)

    monkeypatch.setattr(road_snap, "snap_to_road", snap)
    rider = _client(db, db.get(User, merchant.user_id), shipments.router)
    res = rider.post("/merchants/me/shipments", json={"order_ids": [good.id, bad.id]})
    assert res.status_code == 200, res.text

    db.refresh(good)
    db.refresh(bad)
    db.refresh(merchant)
    assert (merchant.road_lat, merchant.road_lng) == ROAD
    assert (good.delivery_road_lat, good.delivery_road_lng) == ROAD
    assert bad.delivery_road_lat is None
    stops = {s["order_id"]: s for s in res.json()["stops"]}
    assert stops[good.id]["pin_no_road"] is False
    assert stops[bad.id]["pin_no_road"] is True


# --- Item 5: verified pins ---------------------------------------------------


def _saved(db, user, pin=MALOLOS, **extra):
    address = UserAddress(
        user_id=user.id,
        is_default=True,
        lat=pin[0],
        lng=pin[1],
        road_lat=ROAD[0],
        road_lng=ROAD[1],
        pin_confirmed=True,
        **extra,
    )
    db.add(address)
    db.commit()
    return address


def test_delivery_verifies_saved_address_at_the_pin(db, merchant, buyer):
    user = buyer[0]
    address = _saved(db, user)
    other = UserAddress(user_id=user.id, lat=FAR[0], lng=FAR[1])
    db.add(other)
    order = _order(db, merchant, user, status=OrderStatus.SHIPPED)

    mark_delivered(order, "buyer")
    db.commit()
    db.refresh(address)
    db.refresh(other)
    assert address.pin_verified_at is not None
    assert other.pin_verified_at is None


def test_order_without_own_pin_verifies_default_address(db, merchant, buyer):
    user = buyer[0]
    address = _saved(db, user)
    order = _order(
        db, merchant, user, status=OrderStatus.SHIPPED, pin=None, delivery_address=None
    )
    mark_delivered(order, "buyer")
    db.commit()
    db.refresh(address)
    assert address.pin_verified_at is not None


def test_reported_pin_is_not_verified(db, merchant, buyer):
    user = buyer[0]
    address = _saved(db, user)
    order = _order(
        db,
        merchant,
        user,
        status=OrderStatus.SHIPPED,
        pin_unreachable_at=datetime.now(UTC),
    )
    mark_delivered(order, "buyer")
    db.commit()
    db.refresh(address)
    assert address.pin_verified_at is None


def test_moving_the_pin_clears_verified(db, buyer, monkeypatch):
    user = buyer[0]
    monkeypatch.setenv("ROAD_SNAP_PROVIDER", "off")
    address = _saved(db, user, pin_verified_at=datetime.now(UTC))
    me = _client(db, user, user_addresses.router)

    # Only confirming the same pin keeps it verified.
    res = me.patch(f"/users/me/addresses/{address.id}", json={"pin_confirmed": True})
    assert res.status_code == 200, res.text
    assert res.json()["pin_verified_at"] is not None

    res = me.patch(
        f"/users/me/addresses/{address.id}", json={"lat": FAR[0], "lng": FAR[1]}
    )
    assert res.status_code == 200, res.text
    assert res.json()["pin_verified_at"] is None


def test_client_cannot_set_verified(db, buyer):
    me = _client(db, buyer[0], user_addresses.router)
    res = me.post(
        "/users/me/addresses",
        json={
            "lat": MALOLOS[0],
            "lng": MALOLOS[1],
            "pin_verified_at": "2026-01-01T00:00:00Z",
        },
    )
    assert res.status_code == 422


def test_stop_is_verified_after_an_earlier_delivery(db, merchant, buyer, monkeypatch):
    user = buyer[0]
    monkeypatch.setenv("ROAD_SNAP_PROVIDER", "off")
    earlier = _order(db, merchant, user, status=OrderStatus.SHIPPED)
    now = _order(db, merchant, user)
    assert not pinned_location.delivery_pin_verified(db, now, None)

    mark_delivered(earlier, "buyer")
    db.commit()
    assert pinned_location.delivery_pin_verified(db, now, None)
    # A pin far from the delivered one is not verified.
    elsewhere = _order(db, merchant, user, pin=FAR)
    assert not pinned_location.delivery_pin_verified(db, elsewhere, None)

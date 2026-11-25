"""Pin quality: road snap (1), stored road point (2), pin check (5), rider
reports of unreachable pins (6)."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import locations, merchants, orders, shipments, user_addresses
from app.models.cart import Cart
from app.models.notification import Notification
from app.models.order import Order
from app.models.produce import Produce
from app.models.shipment import Shipment
from app.models.statuses import OrderStatus
from app.models.user import User
from app.models.user_address import UserAddress
from app.services import pinned_location, road_snap

MALOLOS = (14.8433, 120.8114)
ROAD = (14.8436, 120.8117)
LAKE = (14.3500, 121.2500)  # Laguna de Bay


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


def _mapbox_on(monkeypatch, handler):
    monkeypatch.setenv("ROAD_SNAP_PROVIDER", "mapbox")
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.test")
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append((url, params))
        return handler(url, params)

    monkeypatch.setattr(road_snap._requests, "get", fake_get)
    return calls


def _road_at(point, distance=35.0):
    return lambda *_: _Resp(
        200,
        {
            "code": "Ok",
            "waypoints": [{"location": [point[1], point[0]], "distance": distance}],
        },
    )


def _no_segment(*_):
    return _Resp(422, {"code": "NoSegment", "message": "No road"})


# --- Control 1: road snap ----------------------------------------------------


def test_mapbox_snap_returns_road_point_and_limits_radius(monkeypatch):
    calls = _mapbox_on(monkeypatch, _road_at(ROAD))
    result = road_snap.snap_to_road(*MALOLOS)
    assert result == road_snap.Snap(road=ROAD, distance_m=35.0)
    url, params = calls[0]
    assert params["radiuses"] == "150;150"
    # Cached: the save after the preview does not call Mapbox again.
    assert road_snap.snap_to_road(*MALOLOS) == result
    assert len(calls) == 1


def test_mapbox_no_segment_is_no_road(monkeypatch):
    _mapbox_on(monkeypatch, _no_segment)
    assert road_snap.snap_to_road(*LAKE) is road_snap.NO_ROAD


def test_road_too_far_is_no_road(monkeypatch):
    _mapbox_on(monkeypatch, _road_at(ROAD, distance=400.0))
    assert road_snap.snap_to_road(*LAKE) is road_snap.NO_ROAD


def test_outage_fails_open_and_is_not_cached(monkeypatch):
    def boom(*_):
        raise road_snap._requests.exceptions.ConnectionError("down")

    calls = _mapbox_on(monkeypatch, boom)
    assert road_snap.snap_to_road(*MALOLOS) is None
    assert road_snap.snap_to_road(*MALOLOS) is None
    assert len(calls) == 2
    # The pin is accepted without a road point.
    assert pinned_location.validate_pin(*MALOLOS) == (MALOLOS, None)
    # Strict (merchant pickup pins): an unchecked pin is refused.
    with pytest.raises(pinned_location.HTTPException) as unchecked:
        pinned_location.validate_pin(*MALOLOS, strict=True)
    assert unchecked.value.status_code == 503


def test_osrm_provider(monkeypatch):
    monkeypatch.setenv("ROAD_SNAP_PROVIDER", "osrm")
    monkeypatch.setenv("OSRM_URL", "http://osrm.local/")
    seen = []

    def fake_get(url, params=None, timeout=None):
        seen.append(url)
        return _road_at(ROAD, 20.0)()

    monkeypatch.setattr(road_snap._requests, "get", fake_get)
    assert road_snap.snap_to_road(*MALOLOS) == road_snap.Snap(ROAD, 20.0)
    assert seen == [f"http://osrm.local/nearest/v1/driving/{MALOLOS[1]},{MALOLOS[0]}"]


def test_provider_off_without_token(monkeypatch):
    monkeypatch.delenv("ROAD_SNAP_PROVIDER", raising=False)
    monkeypatch.delenv("MAPBOX_ACCESS_TOKEN", raising=False)
    assert road_snap.provider() == "off"
    assert road_snap.snap_to_road(*LAKE) is None


def test_validate_pin_refuses_pin_with_no_road(monkeypatch):
    _mapbox_on(monkeypatch, _no_segment)
    with pytest.raises(pinned_location.HTTPException) as exc:
        pinned_location.validate_pin(*LAKE)
    assert exc.value.status_code == 422
    assert "no road" in exc.value.detail.lower()


# --- Control 2: road point stored and used for routing -----------------------


def _client(db, user, *routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_saves_store_the_road_point(db, merchant, buyer, monkeypatch):
    _mapbox_on(monkeypatch, _road_at(ROAD))
    me = _client(db, buyer[0], user_addresses.router)
    res = me.post("/users/me/addresses", json={"lat": MALOLOS[0], "lng": MALOLOS[1]})
    assert res.status_code == 201, res.text
    address = db.get(UserAddress, res.json()["id"])
    assert (address.lat, address.lng) == MALOLOS
    assert (address.road_lat, address.road_lng) == ROAD

    # Clearing the pin clears the road point too.
    res = me.patch(f"/users/me/addresses/{address.id}", json={"lat": None, "lng": None})
    assert res.status_code == 200, res.text
    db.refresh(address)
    assert (address.lat, address.road_lat) == (None, None)

    owner = db.get(User, merchant.user_id)
    store = _client(db, owner, merchants.router)
    assert (
        store.patch(
            "/merchants/me", json={"lat": MALOLOS[0], "lng": MALOLOS[1]}
        ).status_code
        == 200
    )
    db.refresh(merchant)
    assert (merchant.road_lat, merchant.road_lng) == ROAD


def test_lake_pin_is_refused_on_save(db, buyer, monkeypatch):
    _mapbox_on(monkeypatch, _no_segment)
    me = _client(db, buyer[0], user_addresses.router)
    res = me.post("/users/me/addresses", json={"lat": LAKE[0], "lng": LAKE[1]})
    assert res.status_code == 422
    assert db.query(UserAddress).count() == 0


def test_routing_uses_road_point_first():
    def no_geocode(_):
        raise AssertionError("geocoded")

    shop = SimpleNamespace(lat=14.6, lng=121.0, road_lat=14.61, road_lng=121.01)
    assert pinned_location.merchant_point(shop, "x", no_geocode) == (14.61, 121.01)
    order = SimpleNamespace(
        delivery_lat=14.5,
        delivery_lng=121.2,
        delivery_road_lat=14.51,
        delivery_road_lng=121.21,
        delivery_address="X",
    )
    assert pinned_location.delivery_point(order, None, "X", no_geocode) == (
        14.51,
        121.21,
    )
    # No road point (checked during an outage): the pin itself.
    order.delivery_road_lat = order.delivery_road_lng = None
    assert pinned_location.delivery_point(order, None, "X", no_geocode) == (14.5, 121.2)


# --- Control 5: pin check preview ---------------------------------------------


def test_pin_check_previews_road_point(db, buyer, monkeypatch):
    _mapbox_on(monkeypatch, _road_at(ROAD))
    client = _client(db, buyer[0], locations.router)
    res = client.post(
        "/locations/pin-check", json={"lat": MALOLOS[0], "lng": MALOLOS[1]}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["road_lat"], body["road_lng"]) == ROAD
    assert body["road_distance_m"] == pytest.approx(46, abs=3)
    assert (body["unreachable_reports"], body["blocked"]) == (0, False)


def test_pin_check_no_road_and_outside_luzon(db, buyer, monkeypatch):
    _mapbox_on(monkeypatch, _no_segment)
    client = _client(db, buyer[0], locations.router)
    assert (
        client.post(
            "/locations/pin-check", json={"lat": LAKE[0], "lng": LAKE[1]}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/locations/pin-check", json={"lat": 7.07, "lng": 125.61}
        ).status_code
        == 400
    )


# --- Control 6: rider reports -------------------------------------------------


def _shipped_order(db, merchant, buyer_user, pin=MALOLOS):
    shipment = Shipment(
        merchant_id=merchant.id, status="in_transit", route_waypoints=[]
    )
    db.add(shipment)
    db.flush()
    order = Order(
        user_id=buyer_user.id,
        merchant_id=merchant.id,
        status=OrderStatus.SHIPPED,
        total_price=100,
        items=[],
        delivery_lat=pin[0],
        delivery_lng=pin[1],
        shipment_id=shipment.id,
    )
    db.add(order)
    db.commit()
    return order


def test_rider_reports_and_repeat_place_is_blocked(db, merchant, buyer):
    user = buyer[0]
    owner = db.get(User, merchant.user_id)
    rider = _client(db, owner, shipments.router)

    first = _shipped_order(db, merchant, user)
    res = rider.post(
        f"/merchants/me/orders/{first.id}/pin-unreachable",
        json={"note": "Gate locked, no road"},
    )
    assert res.status_code == 204, res.text
    db.refresh(first)
    assert first.pin_unreachable_at is not None
    assert first.pin_unreachable_note == "Gate locked, no road"
    note = db.query(Notification).filter(Notification.user_id == user.id).one()
    assert note.kind == "pin_unreachable"
    # One report per order.
    assert (
        rider.post(
            f"/merchants/me/orders/{first.id}/pin-unreachable", json={}
        ).status_code
        == 409
    )

    near = (MALOLOS[0] + 0.0002, MALOLOS[1])  # ~22 m away
    buyer_client = _client(db, user, locations.router, orders.router)
    check = buyer_client.post(
        "/locations/pin-check", json={"lat": near[0], "lng": near[1]}
    ).json()
    assert (check["unreachable_reports"], check["blocked"]) == (1, False)

    second = _shipped_order(db, merchant, user, pin=near)
    assert (
        rider.post(
            f"/merchants/me/orders/{second.id}/pin-unreachable", json={}
        ).status_code
        == 204
    )

    check = buyer_client.post(
        "/locations/pin-check", json={"lat": MALOLOS[0], "lng": MALOLOS[1]}
    ).json()
    assert (check["unreachable_reports"], check["blocked"]) == (2, True)

    talong = Produce(merchant_id=merchant.id, name="Talong", price=50, stock_quantity=5)
    db.add(talong)
    db.flush()
    db.add(Cart(user_id=user.id, items=[{"produce_id": talong.id, "quantity": 1}]))
    db.commit()
    blocked = buyer_client.post(
        "/orders/me/place",
        json={
            "delivery_address": "12 Mabini St, Malolos, Bulacan",
            "delivery_lat": MALOLOS[0],
            "delivery_lng": MALOLOS[1],
        },
    )
    assert blocked.status_code == 409
    # A pin moved away from the reported place is fine.
    moved = buyer_client.post(
        "/orders/me/place",
        json={
            "delivery_address": "12 Mabini St, Malolos, Bulacan",
            "delivery_lat": MALOLOS[0] + 0.002,
            "delivery_lng": MALOLOS[1],
        },
    )
    assert moved.status_code == 200, moved.text


def test_old_reports_expire(db, merchant, buyer):
    order = _shipped_order(db, merchant, buyer[0])
    order.pin_unreachable_at = datetime.now(UTC) - timedelta(
        days=pinned_location.FLAG_WINDOW_DAYS + 1
    )
    db.commit()
    assert pinned_location.flag_count_near(db, buyer[0].id, MALOLOS) == 0


def test_report_needs_own_shipped_order(db, merchant, buyer):
    owner = db.get(User, merchant.user_id)
    rider = _client(db, owner, shipments.router)
    unshipped = Order(
        user_id=buyer[0].id,
        merchant_id=merchant.id,
        status=OrderStatus.PROCESSING,
        total_price=1,
        items=[],
    )
    db.add(unshipped)
    db.commit()
    assert (
        rider.post(
            f"/merchants/me/orders/{unshipped.id}/pin-unreachable", json={}
        ).status_code
        == 400
    )
    assert (
        rider.post("/merchants/me/orders/99999/pin-unreachable", json={}).status_code
        == 404
    )
    # A buyer is not a merchant.
    as_buyer = _client(db, buyer[0], shipments.router)
    assert (
        as_buyer.post(
            f"/merchants/me/orders/{unshipped.id}/pin-unreachable", json={}
        ).status_code
        == 404
    )

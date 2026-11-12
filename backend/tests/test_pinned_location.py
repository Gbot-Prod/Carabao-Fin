"""U1a: map-pinned coordinates are stored and preferred over geocoding."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants, orders, users
from app.models.cart import Cart
from app.models.order import Order
from app.models.produce import Produce
from app.models.user import User
from app.services.pinned_location import delivery_point, merchant_point, validate_pin
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures

MALOLOS = (14.8433, 120.8114)
DAVAO = (7.0731, 125.6128)


def _no_geocode(_address):
    raise AssertionError("geocoded although a pin was saved")


def test_validate_pin():
    assert validate_pin(None, None) is None
    assert validate_pin(*MALOLOS) == MALOLOS
    with pytest.raises(HTTPException) as half:
        validate_pin(14.8, None)
    assert half.value.status_code == 422
    with pytest.raises(HTTPException) as far:
        validate_pin(*DAVAO)
    assert far.value.status_code == 400 and "Luzon" in far.value.detail
    with pytest.raises(HTTPException):
        validate_pin(123.0, 14.0)


def test_routing_prefers_pins_and_falls_back_to_geocoding():
    pinned_merchant = SimpleNamespace(lat=14.6, lng=121.0)
    assert merchant_point(pinned_merchant, "Somewhere", _no_geocode) == (14.6, 121.0)
    unpinned = SimpleNamespace(lat=None, lng=None)
    assert merchant_point(unpinned, "Malolos", lambda a: MALOLOS) == MALOLOS

    buyer_with_pin = SimpleNamespace(lat=14.7, lng=121.1)
    order_pin = SimpleNamespace(
        delivery_lat=14.5, delivery_lng=121.2, delivery_address="X"
    )
    assert delivery_point(order_pin, buyer_with_pin, "X", _no_geocode) == (14.5, 121.2)
    # Order used the profile address: the profile pin goes with it.
    from_profile = SimpleNamespace(
        delivery_lat=None, delivery_lng=None, delivery_address=None
    )
    assert delivery_point(
        from_profile, buyer_with_pin, "Profile addr", _no_geocode
    ) == (14.7, 121.1)
    # Order typed its own address: the profile pin is for somewhere else.
    typed = SimpleNamespace(
        delivery_lat=None, delivery_lng=None, delivery_address="Typed"
    )
    assert delivery_point(typed, buyer_with_pin, "Typed", lambda a: MALOLOS) == MALOLOS


def _client(db, user, *routers):  # noqa: F811
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_profile_and_store_save_pins(db, merchant, buyer):  # noqa: F811
    me = _client(db, buyer[0], users.router)
    res = me.patch("/users/me", json={"lat": MALOLOS[0], "lng": MALOLOS[1]})
    assert res.status_code == 200, res.text
    assert (res.json()["lat"], res.json()["lng"]) == MALOLOS
    assert (
        me.patch("/users/me", json={"lat": DAVAO[0], "lng": DAVAO[1]}).status_code
        == 400
    )

    owner = db.get(User, merchant.user_id)
    store = _client(db, owner, merchants.router)
    res = store.patch("/merchants/me", json={"lat": 14.6, "lng": 121.0})
    assert res.status_code == 200, res.text
    assert (res.json()["lat"], res.json()["lng"]) == (14.6, 121.0)
    assert (
        store.patch("/merchants/me", json={"lat": 14.6}).status_code == 200
    )  # keeps lng


def test_order_stores_its_delivery_pin(db, merchant, buyer):  # noqa: F811
    talong = Produce(merchant_id=merchant.id, name="Talong", price=50, stock_quantity=5)
    db.add(talong)
    db.flush()
    db.add(Cart(user_id=buyer[0].id, items=[{"produce_id": talong.id, "quantity": 1}]))
    db.commit()
    client = _client(db, buyer[0], orders.router)

    bad = client.post(
        "/orders/me/place", json={"delivery_lat": DAVAO[0], "delivery_lng": DAVAO[1]}
    )
    assert bad.status_code == 400

    res = client.post(
        "/orders/me/place",
        json={
            "delivery_address": "12 Mabini St, Malolos, Bulacan",
            "delivery_lat": MALOLOS[0],
            "delivery_lng": MALOLOS[1],
        },
    )
    assert res.status_code == 200, res.text
    order = db.get(Order, res.json()["order_id"])
    assert (order.delivery_lat, order.delivery_lng) == MALOLOS

"""Pin quality, phase 1: address writes are rate limited and logged (item 3),
and address text is cleaned of hidden characters (item 6)."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants, user_addresses
from app.models.address_change_log import AddressChangeLog
from app.models.user import User
from app.schemas.order import PlaceOrderRequest
from app.schemas.text import clean_one_line
from app.schemas.user_address import UserAddressCreate
from app.services import address_log, rate_limit
from tests.psgc_rows import MALOLOS

PIN = {"lat": 14.8433, "lng": 120.8114}
PIN_MOVED = {"lat": 14.8443, "lng": 120.8114}  # ~111 m north


@pytest.fixture(autouse=True)
def _no_road_service(monkeypatch):
    monkeypatch.setenv("ROAD_SNAP_PROVIDER", "off")


def _client(db, user, *routers):
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _logs(db, user_id):
    return (
        db.query(AddressChangeLog)
        .filter_by(user_id=user_id)
        .order_by(AddressChangeLog.id)
        .all()
    )


# --- Item 3: log ---------------------------------------------------------------


def test_address_changes_are_logged_without_coordinates(db, buyer):
    user = buyer[0]
    me = _client(db, user, user_addresses.router)
    res = me.post("/users/me/addresses", json={**MALOLOS, **PIN, "label": "Home"})
    assert res.status_code == 201, res.text
    address_id = res.json()["id"]

    # A label edit is not a pin or area change: no row.
    assert (
        me.patch(
            f"/users/me/addresses/{address_id}", json={"label": "Bahay"}
        ).status_code
        == 200
    )
    # A re-sent, unchanged pin: no row.
    assert me.patch(f"/users/me/addresses/{address_id}", json=PIN).status_code == 200
    assert (
        me.patch(f"/users/me/addresses/{address_id}", json=PIN_MOVED).status_code == 200
    )
    area = {**MALOLOS, "city": "Hagonoy", "barangay": "San Isidro"}
    assert me.patch(f"/users/me/addresses/{address_id}", json=area).status_code == 200
    assert me.delete(f"/users/me/addresses/{address_id}").status_code == 204

    rows = _logs(db, user.id)
    assert [(r.action, r.pin_change) for r in rows] == [
        ("create", "set"),
        ("update", "moved"),
        ("update", None),
        ("delete", "cleared"),
    ]
    assert rows[0].new_city_code is not None and rows[0].old_city_code is None
    assert 100 < rows[1].pin_moved_m < 125
    assert rows[2].old_city_code != rows[2].new_city_code
    assert rows[3].new_city_code is None
    assert all(
        r.target_type == "user_address" and r.target_id == address_id for r in rows
    )
    # No coordinates or text anywhere in the row.
    columns = {c.name for c in AddressChangeLog.__table__.columns}
    assert not columns & {"lat", "lng", "address", "label", "old_lat", "new_lat"}


def test_shop_location_change_is_logged(db, merchant):
    owner = db.get(User, merchant.user_id)
    store = _client(db, owner, merchants.router)
    assert store.patch("/merchants/me", json=PIN).status_code == 200
    assert store.patch("/merchants/me", json={"delivery_price": 50}).status_code == 200
    rows = _logs(db, owner.id)
    assert [(r.target_type, r.action, r.pin_change) for r in rows] == [
        ("merchant", "update", "set")
    ]


def test_old_rows_are_purged(db, buyer):
    user = buyer[0]
    now = datetime.now(UTC)
    for days in (1, address_log.KEEP_DAYS + 1):
        db.add(
            AddressChangeLog(
                user_id=user.id,
                target_type="user_address",
                target_id=1,
                action="update",
                created_at=now - timedelta(days=days),
            )
        )
    db.commit()
    assert address_log.purge_old(db, now) == 1
    assert len(_logs(db, user.id)) == 1


# --- Item 3: rate limit --------------------------------------------------------


def test_address_writes_are_rate_limited_per_user(db, buyer, merchant, monkeypatch):
    monkeypatch.setitem(
        rate_limit.ACTION_LIMITS, "address_write", rate_limit.Limit(2, 60)
    )
    user = buyer[0]
    me = _client(db, user, user_addresses.router)
    first = me.post("/users/me/addresses", json={**MALOLOS, **PIN})
    assert first.status_code == 201
    assert (
        me.patch(
            f"/users/me/addresses/{first.json()['id']}", json=PIN_MOVED
        ).status_code
        == 200
    )
    blocked = me.post("/users/me/addresses", json={**MALOLOS, **PIN})
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) >= 1
    assert me.delete(f"/users/me/addresses/{first.json()['id']}").status_code == 429

    # Another user has their own count; a shop edit with no location is not counted.
    owner = db.get(User, merchant.user_id)
    store = _client(db, owner, merchants.router)
    for _ in range(3):
        assert (
            store.patch("/merchants/me", json={"delivery_price": 50}).status_code == 200
        )
    assert store.patch("/merchants/me", json=PIN).status_code == 200
    assert store.patch("/merchants/me", json=PIN_MOVED).status_code == 200
    assert store.patch("/merchants/me", json=PIN).status_code == 429


# --- Item 6: hidden characters ---------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("  12  Rizal   St. ", "12 Rizal St."),
        ("12\tRizal\nSt.\r\n", "12 Rizal St."),
        ("Ri​zal‍ St.﻿", "Rizal St."),
        ("Home‮ emoh", "Home emoh"),
        ("Purok 1 Gate B", "Purok 1 Gate B"),
        ("A\x00B\x1bC", "ABC"),
        ("Baños", "Baños"),  # NFC: combining tilde joins its letter
        ("Brgy. Sto. Niño", "Brgy. Sto. Niño"),
    ],
)
def test_clean_one_line(raw, clean):
    assert clean_one_line(raw) == clean


def test_address_fields_are_cleaned(db, buyer):
    me = _client(db, buyer[0], user_addresses.router)
    res = me.post(
        "/users/me/addresses",
        json={**MALOLOS, "label": "Ho​me", "address": "12‮  Rizal\tSt."},
    )
    assert res.status_code == 201, res.text
    assert (res.json()["label"], res.json()["address"]) == ("Home", "12 Rizal St.")

    order = PlaceOrderRequest(delivery_address="12​ Rizal\nSt.")
    assert order.delivery_address == "12 Rizal St."


def test_only_hidden_characters_is_empty():
    assert UserAddressCreate(label="​​").label == ""
    with pytest.raises(ValidationError):
        from app.schemas.merchant import MerchantUpdate

        MerchantUpdate(address="​ ‍")

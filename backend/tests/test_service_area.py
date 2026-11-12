"""B2: Carabao serves the Luzon island group only."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchant_onboarding, merchants, orders
from app.models.cart import Cart
from app.models.order import Order
from app.models.produce import Produce
from app.models.user import User
from app.services.service_area import address_in_luzon, in_luzon_bbox, is_luzon_region
from app.utils import geocoding
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures


@pytest.mark.parametrize(
    "region",
    [
        "National Capital Region (NCR)",
        "NCR",
        "Cordillera Administrative Region (CAR)",
        "Region I (Ilocos Region)",
        "Region II (Cagayan Valley)",
        "Region III",
        "Region III (Central Luzon)",
        "Region IV-A (CALABARZON)",
        "MIMAROPA Region",
        "Region IV-B",
        "Region V (Bicol Region)",
        "region 3",
    ],
)
def test_luzon_regions(region):
    assert is_luzon_region(region)


@pytest.mark.parametrize(
    "region",
    [
        "Region VI (Western Visayas)",
        "Region VII (Central Visayas)",
        "Negros Island Region (NIR)",
        "Region XI (Davao Region)",
        "Region XIII (Caraga)",
        "Bangsamoro Autonomous Region in Muslim Mindanao (BARMM)",
        "",
        None,
    ],
)
def test_regions_outside_luzon(region):
    assert not is_luzon_region(region)


@pytest.mark.parametrize(
    ("address", "expected"),
    [
        ("12 Mabini St, Santo Rosario, Malolos, Bulacan, 3000, Philippines", True),
        ("Unit 5, Barangay 76, Pasay, Philippines", True),
        ("Blk 2 Lot 3, Poblacion, Quezon City", True),
        ("Purok 4, Puerto Princesa, Palawan", True),
        ("Brgy Tikay Malolos Bulacan", True),  # no commas: checked as a whole
        ("12 Rizal St, Lahug, Cebu City, Cebu", False),  # street named after a province
        ("88 Quezon Ave, Poblacion, Davao City", False),
        ("Sunrise Drive, Isabela City, Basilan", False),
        ("Somewhere far away", False),
        ("", False),
    ],
)
def test_free_text_delivery_address(address, expected):
    assert address_in_luzon(address) is expected


def test_bbox_contains_luzon_but_not_visayas_or_mindanao():
    assert in_luzon_bbox(14.5995, 120.9842)  # Manila
    assert in_luzon_bbox(20.45, 121.97)  # Batanes
    assert in_luzon_bbox(9.74, 118.74)  # Puerto Princesa
    assert not in_luzon_bbox(7.07, 125.61)  # Davao City
    assert not in_luzon_bbox(10.32, 124.9)  # Leyte, east of the box


def test_geocoder_asks_mapbox_for_luzon_and_drops_results_outside_the_box(monkeypatch):
    seen = {}

    class Resp:
        ok = True

        def json(self):
            return {"features": [{"center": [125.61, 7.07], "relevance": 1}]}  # Davao

    def fake_get(url, params, timeout):
        seen.update(params)
        return Resp()

    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.test")
    monkeypatch.setattr(geocoding._requests, "get", fake_get)
    assert geocoding._geocode_sync("Poblacion, Davao City") is None
    assert seen["bbox"] == "116.9,7.8,124.5,21.2"


# --- endpoints -----------------------------------------------------------------


def _client(db, user) -> TestClient:
    app = FastAPI()
    for r in (merchant_onboarding.router, merchants.router, orders.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_onboarding_outside_luzon_is_rejected(db, buyer):  # noqa: F811
    payload = {
        "merchant_name": "Cebu Farm",
        "legal_business_name": "Cebu Farm",
        "business_type": "individual",
        "tin": "123456789",
        "registration_type": "dti",
        "registration_number": "X1",
        "contact_email": "farm@example.com",
        "contact_number": "09171234567",
        "region": "Region VII (Central Visayas)",
        "province": "Cebu",
        "city": "Cebu City",
        "barangay": "Lahug",
        "address": "12 Rizal St",
        "postal_code": "6000",
        "delivery_time": 2,
        "delivery_price": 50,
        "price_range_min": 10,
        "price_range_max": 100,
        "available_days": ["mon"],
    }
    resp = _client(db, buyer[0]).post(
        "/merchant-onboarding/me",
        data={"payload": json.dumps(payload)},
        files={"rsbsa_file": ("rsbsa.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 400
    assert "Luzon" in resp.json()["detail"]


def test_merchant_cannot_move_store_outside_luzon(db, merchant):  # noqa: F811
    client = _client(db, db.get(User, merchant.user_id))
    resp = client.patch("/merchants/me", json={"region": "Region XI (Davao Region)"})
    assert resp.status_code == 400
    assert "Luzon" in resp.json()["detail"]
    ok = client.patch("/merchants/me", json={"region": "Region IV-A (CALABARZON)"})
    assert ok.status_code == 200, ok.text


def _cart(db, buyer, merchant):  # noqa: F811
    produce = Produce(
        merchant_id=merchant.id, name="Talong", price=50, stock_quantity=9
    )
    db.add(produce)
    db.flush()
    db.add(Cart(user_id=buyer[0].id, items=[{"produce_id": produce.id, "quantity": 1}]))
    db.commit()


def test_order_outside_luzon_is_rejected(db, merchant, buyer):  # noqa: F811
    _cart(db, buyer, merchant)
    client = _client(db, buyer[0])

    by_region = client.post(
        "/orders/me/place",
        json={"delivery_address": "Lahug, Cebu City", "delivery_region": "Region VII"},
    )
    assert by_region.status_code == 400
    assert "Luzon" in by_region.json()["detail"]

    by_text = client.post(
        "/orders/me/place", json={"delivery_address": "12 Rizal St, Lahug, Cebu City"}
    )
    assert by_text.status_code == 400
    assert "province" in by_text.json()["detail"]
    assert db.query(Order).count() == 0


def test_order_inside_luzon_is_placed(db, merchant, buyer):  # noqa: F811
    _cart(db, buyer, merchant)
    resp = _client(db, buyer[0]).post(
        "/orders/me/place",
        json={
            "delivery_address": "12 Mabini St, Santo Rosario, Malolos, Bulacan",
            "delivery_region": "Region III (Central Luzon)",
        },
    )
    assert resp.status_code == 200, resp.text

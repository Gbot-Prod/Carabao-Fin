"""Listings carry harvest and best-before dates; expired ones leave the shop."""

from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants, orders
from app.models.cart import Cart
from app.models.order import Order
from app.models.produce import Produce
from app.models.user import User
from app.services.produce_freshness import ph_today
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures

TODAY = ph_today()


def _client(db, user: User) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(merchants.router)
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _farmer(db, merchant) -> TestClient:  # noqa: F811
    return _client(db, db.get(User, merchant.user_id))


def _listing(db, merchant, name, best_before, harvest_date=None) -> Produce:  # noqa: F811
    produce = Produce(
        merchant_id=merchant.id,
        name=name,
        price=50,
        stock_quantity=10,
        harvest_date=harvest_date,
        best_before=best_before,
    )
    db.add(produce)
    db.commit()
    return produce


@pytest.fixture
def listings(db, merchant):  # noqa: F811
    """One listing each: expired, last day, still fresh, and pre-dates."""
    return {
        "expired": _listing(
            db, merchant, "Expired", TODAY - timedelta(days=1), TODAY - timedelta(5)
        ),
        "last_day": _listing(db, merchant, "Last day", TODAY, TODAY - timedelta(3)),
        "fresh": _listing(
            db, merchant, "Fresh", TODAY + timedelta(days=4), TODAY - timedelta(1)
        ),
        "undated": _listing(db, merchant, "Undated", None),
    }


def _new_listing(**dates) -> dict:
    return {"name": "Tomato", "price": 60, "stock_quantity": 5, **dates}


# --- farmer: listing form -------------------------------------------------------


def test_create_listing_stores_both_dates(db, merchant):  # noqa: F811
    harvest, best_before = TODAY - timedelta(days=1), TODAY + timedelta(days=5)

    resp = _farmer(db, merchant).post(
        "/produce/",
        json=_new_listing(
            harvest_date=harvest.isoformat(), best_before=best_before.isoformat()
        ),
    )

    assert resp.status_code == 200
    assert resp.json()["harvest_date"] == harvest.isoformat()
    assert resp.json()["best_before"] == best_before.isoformat()


def test_create_listing_requires_both_dates(db, merchant):  # noqa: F811
    client = _farmer(db, merchant)

    assert client.post("/produce/", json=_new_listing()).status_code == 422
    resp = client.post("/produce/", json=_new_listing(harvest_date=TODAY.isoformat()))
    assert resp.status_code == 422
    assert db.query(Produce).count() == 0


@pytest.mark.parametrize(
    ("harvest_offset", "best_before_offset", "detail"),
    [
        (1, 5, "Harvest date cannot be in the future"),
        (0, -1, "Best-before date cannot be earlier than the harvest date"),
    ],
    ids=["future-harvest", "best-before-first"],
)
def test_create_listing_rejects_impossible_dates(
    db,  # noqa: F811
    merchant,  # noqa: F811
    harvest_offset,
    best_before_offset,
    detail,
):
    resp = _farmer(db, merchant).post(
        "/produce/",
        json=_new_listing(
            harvest_date=(TODAY + timedelta(days=harvest_offset)).isoformat(),
            best_before=(TODAY + timedelta(days=best_before_offset)).isoformat(),
        ),
    )

    assert resp.status_code == 400
    assert resp.json()["detail"] == detail
    assert db.query(Produce).count() == 0


def test_editing_an_undated_listing_requires_dates(db, merchant, listings):  # noqa: F811
    undated = listings["undated"]
    client = _farmer(db, merchant)

    resp = client.patch(f"/produce/{undated.id}", json={"price": 70})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Harvest date and best-before date are required"
    db.refresh(undated)
    assert undated.price == 50

    resp = client.patch(
        f"/produce/{undated.id}",
        json={
            "price": 70,
            "harvest_date": TODAY.isoformat(),
            "best_before": (TODAY + timedelta(days=2)).isoformat(),
        },
    )
    assert resp.status_code == 200
    assert resp.json()["price"] == 70


def test_edit_cannot_clear_a_date(db, merchant, listings):  # noqa: F811
    fresh = listings["fresh"]

    resp = _farmer(db, merchant).patch(
        f"/produce/{fresh.id}", json={"best_before": None}
    )

    assert resp.status_code == 400
    db.refresh(fresh)
    assert fresh.best_before is not None


def test_farmer_sees_every_listing_including_expired(db, merchant, listings):  # noqa: F811
    rows = _farmer(db, merchant).get("/merchants/me/produce").json()

    assert {r["name"] for r in rows} == {"Expired", "Last day", "Fresh", "Undated"}
    by_name = {r["name"]: r for r in rows}
    assert by_name["Fresh"]["harvest_date"] == (TODAY - timedelta(1)).isoformat()
    assert by_name["Undated"]["harvest_date"] is None


# --- buyer: shop pages ----------------------------------------------------------

LISTED = {"Last day", "Fresh", "Undated"}


def test_produce_list_hides_expired(db, merchant, buyer, listings):  # noqa: F811
    rows = _client(db, buyer[0]).get(f"/merchants/{merchant.id}/produce").json()

    assert {r["name"] for r in rows} == LISTED


def test_merchant_list_hides_expired(db, merchant, buyer, listings):  # noqa: F811
    [row] = _client(db, buyer[0]).get("/merchants").json()

    assert {p["name"] for p in row["produces"]} == LISTED


def test_merchant_detail_hides_expired(db, merchant, buyer, listings):  # noqa: F811
    body = _client(db, buyer[0]).get(f"/merchants/{merchant.id}").json()

    assert {p["name"] for p in body["produces"]} == LISTED


# --- buyer: checkout ------------------------------------------------------------


def _cart(db, buyer, produce) -> None:  # noqa: F811
    db.add(Cart(user_id=buyer[0].id, items=[{"produce_id": produce.id, "quantity": 2}]))
    db.commit()


def test_expired_listing_cannot_be_ordered(db, buyer, listings):  # noqa: F811
    expired = listings["expired"]
    _cart(db, buyer, expired)

    resp = _client(db, buyer[0]).post("/orders/me/place", json={})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "'Expired' is past its best-before date"
    db.rollback()
    assert db.query(Order).count() == 0
    assert db.get(Produce, expired.id).stock_quantity == 10


def test_listing_on_its_last_day_can_be_ordered(db, buyer, listings):  # noqa: F811
    _cart(db, buyer, listings["last_day"])

    resp = _client(db, buyer[0]).post("/orders/me/place", json={})

    assert resp.status_code == 200

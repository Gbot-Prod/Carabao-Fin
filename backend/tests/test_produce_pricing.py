"""Minimum order quantity and bulk price tiers, enforced on the server."""

from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import carts, merchants, orders
from app.models.cart import Cart
from app.models.order import Order
from app.models.produce import Produce
from app.models.user import User
from app.services.produce_freshness import ph_today
from app.services.produce_pricing import unit_price_for
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures

TODAY = ph_today()
TIERS = [{"min_qty": 10, "unit_price": 45}, {"min_qty": 25, "unit_price": 40}]


def _client(db, user: User) -> TestClient:  # noqa: F811
    app = FastAPI()
    for module in (merchants, orders, carts):
        app.include_router(module.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _farmer(db, merchant) -> TestClient:  # noqa: F811
    return _client(db, db.get(User, merchant.user_id))


@pytest.fixture
def tomatoes(db, merchant):  # noqa: F811
    """₱50 each, minimum order 3; ₱45 from 10, ₱40 from 25."""
    produce = Produce(
        merchant_id=merchant.id,
        name="Tomato",
        price=50,
        stock_quantity=100,
        min_order_qty=3,
        price_tiers=TIERS,
        harvest_date=TODAY - timedelta(days=1),
        best_before=TODAY + timedelta(days=5),
    )
    db.add(produce)
    db.commit()
    return produce


def _listing(**overrides) -> dict:
    return {
        "name": "Tomato",
        "price": 50,
        "stock_quantity": 100,
        "harvest_date": TODAY.isoformat(),
        "best_before": (TODAY + timedelta(days=5)).isoformat(),
        **overrides,
    }


# --- pricing rule ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("quantity", "unit_price"),
    [(3, 50), (9, 50), (10, 45), (24, 45), (25, 40), (90, 40)],
)
def test_highest_tier_reached_prices_the_line(tomatoes, quantity, unit_price):
    assert unit_price_for(tomatoes, quantity) == unit_price


def test_listing_without_tiers_uses_its_price(db, merchant):  # noqa: F811
    produce = Produce(merchant_id=merchant.id, name="Kale", price=30)
    db.add(produce)
    db.commit()

    assert produce.min_order_qty == 1
    assert unit_price_for(produce, 500) == 30


# --- farmer: listing form -------------------------------------------------------


def test_create_listing_stores_minimum_and_sorted_tiers(db, merchant):  # noqa: F811
    resp = _farmer(db, merchant).post(
        "/produce/",
        json=_listing(min_order_qty=3, price_tiers=list(reversed(TIERS))),
    )

    assert resp.status_code == 200
    assert resp.json()["min_order_qty"] == 3
    assert resp.json()["price_tiers"] == TIERS
    assert db.query(Produce).one().price_tiers == TIERS


def test_listing_defaults_to_no_minimum_and_no_tiers(db, merchant):  # noqa: F811
    body = _farmer(db, merchant).post("/produce/", json=_listing()).json()

    assert body["min_order_qty"] == 1
    assert body["price_tiers"] == []


@pytest.mark.parametrize(
    ("overrides", "detail"),
    [
        (
            {"price_tiers": [{"min_qty": 10, "unit_price": 50}]},
            "Each price tier must be cheaper than the price before it",
        ),
        (
            {
                "price_tiers": [
                    {"min_qty": 10, "unit_price": 40},
                    {"min_qty": 25, "unit_price": 45},
                ]
            },
            "Each price tier must be cheaper than the price before it",
        ),
        (
            {
                "price_tiers": [
                    {"min_qty": 10, "unit_price": 45},
                    {"min_qty": 10, "unit_price": 40},
                ]
            },
            "Each price tier needs a different quantity",
        ),
        (
            {"min_order_qty": 10, "price_tiers": [{"min_qty": 10, "unit_price": 45}]},
            "Price tiers must start above the minimum order quantity",
        ),
    ],
    ids=["not-cheaper", "price-rises", "duplicate-qty", "tier-at-minimum"],
)
def test_create_listing_rejects_bad_tiers(db, merchant, overrides, detail):  # noqa: F811
    resp = _farmer(db, merchant).post("/produce/", json=_listing(**overrides))

    assert resp.status_code == 400
    assert resp.json()["detail"] == detail
    assert db.query(Produce).count() == 0


@pytest.mark.parametrize(
    "overrides",
    [
        {"min_order_qty": 0},
        {"price_tiers": [{"min_qty": 1, "unit_price": 45}]},
        {"price_tiers": [{"min_qty": 10, "unit_price": 0}]},
        {"price_tiers": [{"min_qty": q, "unit_price": 50 - q} for q in range(2, 8)]},
    ],
    ids=["zero-minimum", "tier-of-one", "free-tier", "too-many-tiers"],
)
def test_create_listing_rejects_invalid_values(db, merchant, overrides):  # noqa: F811
    resp = _farmer(db, merchant).post("/produce/", json=_listing(**overrides))

    assert resp.status_code == 422
    assert db.query(Produce).count() == 0


def test_lowering_the_price_below_a_tier_is_refused(db, merchant, tomatoes):  # noqa: F811
    resp = _farmer(db, merchant).patch(f"/produce/{tomatoes.id}", json={"price": 44})

    assert resp.status_code == 400
    assert resp.json()["detail"] == (
        "Each price tier must be cheaper than the price before it"
    )
    db.refresh(tomatoes)
    assert tomatoes.price == 50


def test_edit_replaces_or_keeps_tiers(db, merchant, tomatoes):  # noqa: F811
    client = _farmer(db, merchant)

    kept = client.patch(f"/produce/{tomatoes.id}", json={"stock_quantity": 80}).json()
    assert kept["price_tiers"] == TIERS

    cleared = client.patch(f"/produce/{tomatoes.id}", json={"price_tiers": []}).json()
    assert cleared["price_tiers"] == []


def test_edit_cannot_null_the_minimum(db, merchant, tomatoes):  # noqa: F811
    resp = _farmer(db, merchant).patch(
        f"/produce/{tomatoes.id}", json={"min_order_qty": None}
    )

    assert resp.status_code == 422


# --- buyer: cart and checkout ---------------------------------------------------


def _cart(db, buyer, produce, quantity) -> None:  # noqa: F811
    db.add(
        Cart(
            user_id=buyer[0].id,
            items=[{"produce_id": produce.id, "quantity": quantity, "price": 1}],
        )
    )
    db.commit()


def test_order_below_minimum_is_refused(db, buyer, tomatoes):  # noqa: F811
    _cart(db, buyer, tomatoes, 2)

    resp = _client(db, buyer[0]).post("/orders/me/place", json={})

    assert resp.status_code == 400
    assert resp.json()["detail"] == "'Tomato' has a minimum order of 3, 2 requested"
    db.rollback()
    assert db.query(Order).count() == 0
    assert db.get(Produce, tomatoes.id).stock_quantity == 100


@pytest.mark.parametrize(("quantity", "unit_price"), [(3, 50), (10, 45), (30, 40)])
def test_order_is_priced_by_the_server(db, buyer, tomatoes, quantity, unit_price):  # noqa: F811
    # The cart claims ₱1 a unit; the server ignores it.
    _cart(db, buyer, tomatoes, quantity)

    resp = _client(db, buyer[0]).post("/orders/me/place", json={})

    assert resp.status_code == 200
    order = db.get(Order, resp.json()["order_id"])
    delivery_fee = tomatoes.merchant.delivery_price or 0
    assert order.total_price == quantity * unit_price + delivery_fee
    assert order.items[0]["price"] == unit_price


def test_cart_shows_tier_price_and_minimum(db, buyer, tomatoes):  # noqa: F811
    resp = _client(db, buyer[0]).put(
        "/carts/me",
        json={"items": [{"produce_id": tomatoes.id, "quantity": 12, "price": 1}]},
    )

    assert resp.status_code == 200
    [item] = resp.json()["items"]
    assert item["price"] == 45
    assert item["min_order_qty"] == 3

"""F1: low-stock and expiry alerts on the merchant dashboard."""

from datetime import timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import stock_alerts
from app.models.produce import Produce
from app.models.user import User
from app.services.produce_freshness import is_listed, ph_today
from tests.test_reviews import _buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(stock_alerts.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _produce(db, merchant, name, stock, best_before_days):  # noqa: F811
    today = ph_today()
    p = Produce(
        merchant_id=merchant.id,
        name=name,
        price=50,
        unit="kg",
        stock_quantity=stock,
        harvest_date=today - timedelta(days=5),
        best_before=today + timedelta(days=best_before_days)
        if best_before_days is not None
        else None,
    )
    db.add(p)
    db.commit()
    return p


def test_flags_low_stock_expiring_and_expired(db, merchant):  # noqa: F811
    owner = db.get(User, merchant.user_id)
    _produce(db, merchant, "Talong", 3, 10)  # low stock
    _produce(db, merchant, "Kamatis", 50, 2)  # expires in 2 days
    _produce(db, merchant, "Pechay", 2, 0)  # expires today and low stock
    _produce(db, merchant, "Okra", 0, -1)  # expired yesterday
    _produce(db, merchant, "Sitaw", 40, None)  # fine, no dates
    _produce(db, merchant, "Kalabasa", 30, 3)  # fine

    data = _client(db, owner).get("/merchants/me/stock-alerts").json()
    assert data["low_stock_threshold"] == 5
    assert [i["name"] for i in data["low_stock"]] == ["Pechay", "Talong"]
    assert [(i["name"], i["days_left"]) for i in data["expiring_soon"]] == [
        ("Pechay", 0),
        ("Kamatis", 2),
    ]
    # Expired is reported once, not also as low stock.
    assert [i["name"] for i in data["expired"]] == ["Okra"]


def test_merchant_sets_threshold(db, merchant):  # noqa: F811
    owner = db.get(User, merchant.user_id)
    _produce(db, merchant, "Talong", 8, 10)
    client = _client(db, owner)
    assert client.get("/merchants/me/stock-alerts").json()["low_stock"] == []

    res = client.patch("/merchants/me/stock-alerts", json={"low_stock_threshold": 10})
    assert res.status_code == 200
    assert [i["name"] for i in res.json()["low_stock"]] == ["Talong"]
    db.refresh(merchant)
    assert merchant.low_stock_threshold == 10

    off = client.patch("/merchants/me/stock-alerts", json={"low_stock_threshold": 0})
    assert off.json()["low_stock"] == []
    bad = client.patch("/merchants/me/stock-alerts", json={"low_stock_threshold": -1})
    assert bad.status_code == 422


def test_hidden_listings_left_out_and_non_merchant_404(db, merchant):  # noqa: F811
    owner = db.get(User, merchant.user_id)
    p = _produce(db, merchant, "Talong", 1, 1)
    p.hidden_at = p.harvest_date  # any timestamp
    db.commit()
    data = _client(db, owner).get("/merchants/me/stock-alerts").json()
    assert data["low_stock"] == [] and data["expiring_soon"] == []

    buyer, _ = _buyer(db)
    assert _client(db, buyer).get("/merchants/me/stock-alerts").status_code == 404


def test_expired_listings_are_not_listed_for_buyers(db, merchant):  # noqa: F811
    _produce(db, merchant, "Okra", 10, -1)
    _produce(db, merchant, "Kamatis", 10, 0)
    names = {p.name for p in db.query(Produce).filter(is_listed(ph_today())).all()}
    assert names == {"Kamatis"}

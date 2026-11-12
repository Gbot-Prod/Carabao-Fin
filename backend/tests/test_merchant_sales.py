"""F2: merchant sales charts (daily revenue/orders, top products)."""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchant_sales
from app.models.order import Order
from app.models.statuses import TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from tests.test_reviews import _buyer, buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(merchant_sales.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _order(db, merchant, buyer, total, items, days_ago, status="delivered", paid=True):  # noqa: F811
    user, history = buyer
    order = Order(
        order_history_id=history.id,
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=total,
        items=items,
        ordered_at=datetime.now(UTC) - timedelta(days=days_ago),
    )
    db.add(order)
    db.flush()
    db.add(
        Transaction(
            order_id=order.id,
            merchant_id=merchant.id,
            user_id=user.id,
            amount=total,
            platform_fee=0,
            merchant_amount=total,
            status=TransactionStatus.PAID if paid else TransactionStatus.PENDING,
        )
    )
    db.commit()
    return order


def test_daily_series_and_top_products(db, merchant, buyer):  # noqa: F811
    talong = {"produce_id": 1, "name": "Talong", "quantity": 2, "price": 50}
    kamatis = {"produce_id": 2, "name": "Kamatis", "quantity": 5, "price": 40}
    _order(db, merchant, buyer, 140, [talong, {**kamatis, "quantity": 1}], 0)
    _order(db, merchant, buyer, 200, [kamatis], 3)
    _order(db, merchant, buyer, 999, [talong], 1, status="cancelled")  # no revenue
    _order(db, merchant, buyer, 999, [talong], 2, paid=False)  # never paid
    _order(db, merchant, buyer, 500, [talong], 45)  # outside 30 days

    owner = db.get(User, merchant.user_id)
    data = _client(db, owner).get("/merchants/me/sales?days=30").json()
    assert data["days"] == 30 and len(data["daily"]) == 30
    assert data["total_revenue"] == 340 and data["total_orders"] == 2
    assert sum(d["orders"] for d in data["daily"]) == 2
    assert data["daily"][-1]["revenue"] == 140  # today is last
    assert [(p["name"], p["quantity"], p["revenue"]) for p in data["top_products"]] == [
        ("Kamatis", 6, 240),
        ("Talong", 2, 100),
    ]

    ninety = _client(db, owner).get("/merchants/me/sales?days=90").json()
    assert len(ninety["daily"]) == 90 and ninety["total_revenue"] == 840


def test_rejects_other_windows_and_non_merchants(db, merchant):  # noqa: F811
    owner = db.get(User, merchant.user_id)
    assert _client(db, owner).get("/merchants/me/sales?days=7").status_code == 422
    stranger, _ = _buyer(db, email="stranger@example.com")
    assert _client(db, stranger).get("/merchants/me/sales").status_code == 404

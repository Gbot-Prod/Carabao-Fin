"""The merchant's orders tab sees what the buyer asked for at checkout."""

from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants
from app.models.order import Order
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures


def _merchant_client(db, merchant) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, merchant.user_id)
    return TestClient(app)


def _scheduled_order(db, merchant, buyer, **schedule):
    """A paid order: the only kind the merchant's orders tab shows."""
    user, history = buyer
    order = Order(
        order_history_id=history.id,
        user_id=user.id,
        merchant_id=merchant.id,
        status=OrderStatus.PROCESSING,
        total_price=500,
        items=[],
        **schedule,
    )
    db.add(order)
    db.flush()
    db.add(
        Transaction(
            order_id=order.id,
            merchant_id=merchant.id,
            user_id=user.id,
            amount=500,
            platform_fee=10,
            merchant_amount=490,
            status=TransactionStatus.PAID,
        )
    )
    db.commit()
    return order


def test_order_list_includes_schedule_and_notes(db, merchant, buyer):  # noqa: F811
    scheduled = _scheduled_order(
        db,
        merchant,
        buyer,
        requested_delivery_date=date(2026, 11, 20),
        delivery_window="08:00 – 10:00",
        notes="Leave at the gate",
    )
    legacy = _scheduled_order(db, merchant, buyer)

    rows = {
        o["id"]: o
        for o in _merchant_client(db, merchant).get("/merchants/me/orders").json()
    }

    assert rows[scheduled.id]["requested_delivery_date"] == "2026-11-20"
    assert rows[scheduled.id]["delivery_window"] == "08:00 – 10:00"
    assert rows[scheduled.id]["notes"] == "Leave at the gate"
    assert rows[legacy.id]["requested_delivery_date"] is None
    assert rows[legacy.id]["notes"] is None


def test_status_update_keeps_schedule_and_notes(db, merchant, buyer):  # noqa: F811
    order = _scheduled_order(
        db,
        merchant,
        buyer,
        requested_delivery_date=date(2026, 11, 20),
        delivery_window="14:00 – 16:00",
        notes="Call on arrival",
    )

    resp = _merchant_client(db, merchant).patch(
        f"/merchants/me/orders/{order.id}/status", json={"status": "cancelled"}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "cancelled"
    assert body["payment_status"] == "refund_pending"
    assert body["requested_delivery_date"] == "2026-11-20"
    assert body["delivery_window"] == "14:00 – 16:00"
    assert body["notes"] == "Call on arrival"

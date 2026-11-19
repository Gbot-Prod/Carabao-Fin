"""CF-0073 (B80, B84, B82): open orders and shipments are never cut off by a
window, and the data export holds the person's notifications."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants, shipments
from app.models.notification import Notification
from app.models.order import Order
from app.models.shipment import Shipment
from app.models.statuses import TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.services import data_export
from tests.shared_fixtures import _buyer

START = datetime(2026, 10, 1, tzinfo=UTC)


def _paid_order(
    db: Session, merchant: Any, user: User, status: str, days: int, **extra: Any
) -> Order:
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=100,
        items=[],
        ordered_at=START + timedelta(days=days),
        **extra,
    )
    db.add(order)
    db.flush()
    db.add(
        Transaction(
            order_id=order.id,
            merchant_id=merchant.id,
            user_id=user.id,
            amount=100,
            platform_fee=2,
            merchant_amount=98,
            status=TransactionStatus.PAID,
        )
    )
    return order


def _client(db: Session, merchant: Any) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.include_router(shipments.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, merchant.user_id)
    return TestClient(app)


def test_old_open_order_stays_in_the_orders_tab(
    db: Session, merchant: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(merchants, "MERCHANT_CLOSED_ORDERS_SHOWN", 3)
    buyer, _ = _buyer(db, "b@example.com")
    old_open = _paid_order(db, merchant, buyer, "processing", days=0)
    delivered = [
        _paid_order(db, merchant, buyer, "delivered", days=d) for d in range(1, 6)
    ]
    db.commit()

    rows = _client(db, merchant).get("/merchants/me/orders").json()

    ids = [r["id"] for r in rows]
    # Before CF-0073 the newest N won and the old open order was cut off.
    assert old_open.id in ids
    assert ids == [o.id for o in delivered[::-1][:3]] + [old_open.id]


def test_old_open_shipment_stays_listed(
    db: Session, merchant: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(shipments, "SHIPMENTS_SHOWN", 2)
    buyer, _ = _buyer(db, "b@example.com")
    made = []
    for day in range(4):
        shipment = Shipment(
            merchant_id=merchant.id,
            stop_count=1,
            route_waypoints=[],
            created_at=START + timedelta(days=day),
        )
        db.add(shipment)
        db.flush()
        status = "shipped" if day == 0 else "delivered"  # only the oldest is open
        _paid_order(db, merchant, buyer, status, days=day, shipment_id=shipment.id)
        made.append(shipment)
    db.commit()

    rows = _client(db, merchant).get("/merchants/me/shipments").json()

    assert [r["id"] for r in rows] == [made[3].id, made[2].id, made[0].id]
    assert {r["id"]: r["completed_stop_count"] for r in rows}[made[0].id] == 0


def test_export_has_my_notifications_only(db: Session) -> None:
    me, _ = _buyer(db, "me@example.com")
    other, _ = _buyer(db, "other@example.com")
    db.add_all(
        [
            Notification(user_id=me.id, kind="order_placed", title="Mine", body="b"),
            Notification(
                user_id=other.id, kind="order_placed", title="Theirs", body="b"
            ),
        ]
    )
    db.commit()

    data = data_export.build_export(db, me)

    assert [n["title"] for n in data["notifications"]] == ["Mine"]

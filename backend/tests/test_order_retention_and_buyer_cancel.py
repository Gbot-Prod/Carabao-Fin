"""CF-0044 retention sweep and buyer cancel during processing."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders
from app.models.chat import ChatMessage, Conversation, ConversationRead
from app.models.notification import Notification
from app.models.shipment import Shipment
from app.models.user_address import UserAddress
from app.services import chat
from app.services.order_retention import purge_closed_order_details
from tests.test_order_cancel_flow import _setup


def _close(db, order, days_ago, status="delivered"):
    order.status = status
    order.closed_at = datetime.now(UTC) - timedelta(days=days_ago)
    if status == "delivered":
        order.delivered_at = order.closed_at
    order.delivery_address = "12 Rizal St, Lipa"
    order.delivery_lat = 13.94
    order.delivery_lng = 121.16
    order.notes = "Blue gate"
    order.route_waypoints = [{"lat": 13.94, "lng": 121.16}]
    db.commit()


def _chat(db, order, user_id):
    conv = Conversation(kind="order", order_id=order.id)
    db.add(conv)
    db.flush()
    msg = ChatMessage(
        conversation_id=conv.id, sender_id=user_id, sender_role="buyer", body="Hi"
    )
    db.add(msg)
    db.flush()
    db.add(
        ConversationRead(
            conversation_id=conv.id, user_id=user_id, last_read_message_id=msg.id
        )
    )
    db.commit()
    return conv


def test_purge_removes_chat_and_delivery_details_after_14_days(db, merchant, buyer):
    user, _ = buyer
    old, _, old_txn = _setup(db, merchant, buyer)
    recent, _, _ = _setup(db, merchant, buyer)
    _close(db, old, days_ago=15)
    _close(db, recent, days_ago=10)
    _chat(db, old, user.id)
    _chat(db, recent, user.id)
    saved = UserAddress(user_id=user.id, address="12 Rizal St, Lipa", label="Home")
    db.add(saved)
    db.commit()

    assert purge_closed_order_details(db, 14) == 1
    db.commit()
    db.refresh(old)
    db.refresh(recent)
    db.refresh(saved)

    assert old.delivery_address is None
    assert (old.delivery_lat, old.delivery_lng) == (None, None)
    assert old.notes is None
    assert old.route_waypoints is None
    assert old.details_purged_at is not None
    assert old.total_price == 150 and old.items  # the sale record stays
    assert old_txn.id is not None
    assert db.query(Conversation).filter_by(order_id=old.id).count() == 0
    assert db.query(ChatMessage).count() == 1
    assert db.query(ConversationRead).count() == 1

    assert recent.delivery_address == "12 Rizal St, Lipa"
    assert db.query(Conversation).filter_by(order_id=recent.id).count() == 1
    assert saved.address == "12 Rizal St, Lipa"  # saved addresses are not touched

    assert purge_closed_order_details(db, 14) == 0  # runs once per order


def test_purge_waits_for_an_open_refund(db, merchant, buyer):
    order, _, txn = _setup(db, merchant, buyer)
    _close(db, order, days_ago=20, status="cancelled")
    txn.status = "refund_pending"
    db.commit()
    assert purge_closed_order_details(db, 14) == 0

    txn.status = "refunded"
    db.commit()
    assert purge_closed_order_details(db, 14) == 1


def test_purge_skips_open_orders(db, merchant, buyer):
    order, _, _ = _setup(db, merchant, buyer, "shipped", paid_days_ago=30)
    order.closed_at = datetime.now(UTC) - timedelta(days=30)  # inconsistent row
    order.delivery_address = "Kept"
    db.commit()
    assert purge_closed_order_details(db, 14) == 0


def test_shipment_route_cleared_when_all_its_orders_are_purged(db, merchant, buyer):
    shipment = Shipment(
        merchant_id=merchant.id,
        stop_count=2,
        status="completed",
        route_waypoints=[{"lat": 13.9, "lng": 121.1}],
    )
    db.add(shipment)
    db.flush()
    first, _, _ = _setup(db, merchant, buyer)
    second, _, _ = _setup(db, merchant, buyer)
    for order in (first, second):
        order.shipment_id = shipment.id
    _close(db, first, days_ago=20)
    _close(db, second, days_ago=5)

    purge_closed_order_details(db, 14)
    db.commit()
    db.refresh(shipment)
    assert shipment.route_waypoints  # second order not purged yet

    second.closed_at = datetime.now(UTC) - timedelta(days=15)
    db.commit()
    purge_closed_order_details(db, 14)
    db.commit()
    db.refresh(shipment)
    assert shipment.route_waypoints == []


def test_chat_closes_7_days_after_cancel_and_after_purge(db, merchant, buyer):
    order, _, _ = _setup(db, merchant, buyer)
    _close(db, order, days_ago=8, status="cancelled")
    assert chat.is_closed(order)

    order.closed_at = datetime.now(UTC) - timedelta(days=1)
    assert not chat.is_closed(order)
    order.details_purged_at = datetime.now(UTC)
    assert chat.is_closed(order)


def test_closing_an_order_sets_closed_at(db, merchant, buyer):
    order, _, _ = _setup(db, merchant, buyer, "shipped")
    from app.services.order_status import mark_delivered

    mark_delivered(order, "buyer")
    assert order.closed_at == order.delivered_at


# Buyer cancel -----------------------------------------------------------------


@pytest.fixture
def buyer_client(db, buyer):
    user, _ = buyer
    app = FastAPI()
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_buyer_cancels_processing_order(db, merchant, buyer, buyer_client):
    user, _ = buyer
    order, produce, txn = _setup(db, merchant, buyer, "processing")

    res = buyer_client.post(f"/orders/me/{order.id}/cancel")
    assert res.status_code == 200, res.text
    for row in (order, produce, txn):
        db.refresh(row)
    assert order.status == "cancelled"
    assert order.closed_at is not None
    assert produce.stock_quantity == 13
    assert txn.status == "refund_pending"
    farm_notice = (
        db.query(Notification)
        .filter_by(user_id=merchant.user_id, kind="order_cancelled")
        .one()
    )
    assert "buyer cancelled" in farm_notice.body


@pytest.mark.parametrize(
    "status", ["pending", "shipped", "out_for_delivery", "delivered", "cancelled"]
)
def test_buyer_cannot_cancel_outside_processing(
    db, merchant, buyer, buyer_client, status
):
    order, _, _ = _setup(db, merchant, buyer, status)
    res = buyer_client.post(f"/orders/me/{order.id}/cancel")
    assert res.status_code == 409
    db.refresh(order)
    assert order.status == status


def test_buyer_cannot_cancel_someone_elses_order(db, merchant, buyer, buyer_client):
    order, _, _ = _setup(db, merchant, buyer)
    order.user_id = merchant.user_id
    db.commit()
    assert buyer_client.post(f"/orders/me/{order.id}/cancel").status_code == 404

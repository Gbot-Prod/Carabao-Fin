"""U5: in-app notifications and SMS/email preferences."""

from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import notifications as routes
from app.api.routes import orders
from app.models.cart import Cart
from app.models.notification import Notification
from app.models.order import Order
from app.models.produce import Produce
from app.models.transaction import Transaction
from app.models.user import User
from app.services import notifications, order_status, refund_service
from app.services.order_reservations import settle_checkout_payment
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user, *routers) -> TestClient:  # noqa: F811
    app = FastAPI()
    for r in routers or (routes.router,):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _kinds(db, user_id):  # noqa: F811
    return [
        n.kind
        for n in db.query(Notification)
        .filter(Notification.user_id == user_id)
        .order_by(Notification.id)
    ]


def _order(db, merchant, buyer, status="pending"):  # noqa: F811
    user, history = buyer
    order = Order(
        order_history_id=history.id,
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=500,
        items=[],
        ordered_at=datetime(2026, 11, 12, tzinfo=UTC),
    )
    db.add(order)
    db.commit()
    return order


def test_order_lifecycle_notifies_buyer_and_farm(db, merchant, buyer):  # noqa: F811
    user, _ = buyer
    talong = Produce(merchant_id=merchant.id, name="Talong", price=50, stock_quantity=5)
    db.add(talong)
    db.flush()
    db.add(Cart(user_id=user.id, items=[{"produce_id": talong.id, "quantity": 1}]))
    db.commit()
    res = _client(db, user, orders.router).post("/orders/me/place", json={})
    assert res.status_code == 200, res.text
    order = db.get(Order, res.json()["order_id"])
    assert _kinds(db, user.id) == ["order_placed"]

    txn = Transaction(
        order_id=order.id,
        merchant_id=merchant.id,
        user_id=user.id,
        amount=order.total_price,
        platform_fee=1,
        merchant_amount=order.total_price - 1,
        status="pending",
    )
    db.add(txn)
    db.commit()
    assert settle_checkout_payment(txn, "pay_1", db) == "paid"
    db.commit()
    order_status.apply_merchant_transition(order, "shipped", db)
    order_status.apply_merchant_transition(order, "out_for_delivery", db)
    order_status.mark_delivered(order, "buyer")
    db.commit()

    assert _kinds(db, user.id) == [
        "order_placed",
        "order_paid",
        "order_shipped",
        "order_out_for_delivery",
        "order_delivered",
    ]
    assert _kinds(db, merchant.user_id) == ["new_order"]
    delivered = db.query(Notification).filter_by(kind="order_delivered").one()
    assert delivered.link == f"/orders/{order.id}"
    assert delivered.title == f"Order CB-2026-{order.id:04d} was delivered"


def test_bell_api_lists_counts_and_marks_read(db, merchant, buyer):  # noqa: F811
    user, _ = buyer
    for i in range(3):
        notifications.notify(db, user.id, "order_placed", f"Order {i}")
    other = User(email="other@example.com", notifications_preferences={})
    db.add(other)
    db.flush()
    notifications.notify(db, other.id, "order_placed", "Not yours")
    db.commit()
    client = _client(db, user)

    body = client.get("/users/me/notifications").json()
    assert body["unread"] == 3 and [n["title"] for n in body["items"]][0] == "Order 2"
    first = body["items"][0]["id"]
    assert client.post(f"/users/me/notifications/{first}/read").status_code == 204
    assert client.get("/users/me/notifications").json()["unread"] == 2
    assert (
        len(client.get("/users/me/notifications?unread_only=true").json()["items"]) == 2
    )

    theirs = db.query(Notification).filter_by(user_id=other.id).one()
    assert client.post(f"/users/me/notifications/{theirs.id}/read").status_code == 404
    assert client.post("/users/me/notifications/read-all").status_code == 204
    assert client.get("/users/me/notifications").json()["unread"] == 0
    assert db.get(Notification, theirs.id).read_at is None


def test_preferences_gate_sms_and_email():
    yes = User(email="a@example.com", notifications_preferences={})
    no_sms = User(
        email="b@example.com", notifications_preferences={"order_updates": False}
    )
    no_email = User(
        email="c@example.com", notifications_preferences={"email_alerts": False}
    )
    assert notifications.wants(yes, "sms") and notifications.wants(yes, "email")
    assert not notifications.wants(no_sms, "sms") and notifications.wants(
        no_sms, "email"
    )
    assert notifications.wants(no_email, "sms") and not notifications.wants(
        no_email, "email"
    )
    assert not notifications.wants(None, "sms")


def test_refund_respects_preferences_but_always_notifies_in_app(
    db,
    merchant,
    buyer,
    monkeypatch,  # noqa: F811
):
    user, _ = buyer
    user.phone_number = "639171112222"
    user.notifications_preferences = {"order_updates": False, "email_alerts": False}
    db.commit()
    sent = []
    monkeypatch.setattr(
        refund_service.email, "send_refund_email", lambda *a, **k: sent.append("email")
    )
    monkeypatch.setattr(refund_service, "send_sms", lambda **k: sent.append("sms"))
    order = _order(db, merchant, buyer, "cancelled")
    txn = Transaction(
        order_id=order.id,
        merchant_id=merchant.id,
        user_id=user.id,
        amount=500,
        platform_fee=10,
        merchant_amount=490,
        status="refund_pending",
    )
    admin = User(email="admin@example.com", is_admin=True, notifications_preferences={})
    db.add_all([txn, admin])
    db.commit()

    refund_service.record_refund(
        db, transaction_id=txn.id, admin=admin, method="gcash", reference="GC-1"
    )

    assert sent == []
    assert _kinds(db, user.id) == ["refund"]

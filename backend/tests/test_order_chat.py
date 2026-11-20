"""CH1a: order chat between buyer and farm, readable by admins only besides them."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import chat as chat_routes
from app.models.chat import ChatMessage
from app.models.notification import Notification
from app.models.order import Order
from app.models.user import User
from app.services import chat
from tests.better_auth import make_user, set_identity
from tests.test_merchant_listings import _other_merchant
from tests.test_reviews import _buyer


def _client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(chat_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


@pytest.fixture
def order(db, merchant, buyer):  # noqa: F811
    user, _ = buyer
    row = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status="processing",
        total_price=500,
        items=[],
        ordered_at=datetime(2026, 11, 12, tzinfo=UTC),
    )
    db.add(row)
    db.commit()
    return row


def _post(client, order_id, body):
    return client.post(f"/orders/{order_id}/messages", json={"body": body})


def test_buyer_and_farm_talk_and_admin_can_join(db, merchant, buyer, order):  # noqa: F811
    farmer = db.get(User, merchant.user_id)
    admin = make_user(
        db, "admin@example.com", is_admin=True, notifications_preferences={}
    )
    db.add(admin)
    db.commit()

    assert (
        _post(_client(db, buyer[0]), order.id, "Is the talong fresh?").status_code
        == 200
    )
    assert (
        _post(_client(db, farmer), order.id, "Harvested this morning!").status_code
        == 200
    )
    assert (
        _post(_client(db, admin), order.id, "Support here, all good.").status_code
        == 200
    )

    thread = _client(db, buyer[0]).get(f"/orders/{order.id}/messages").json()
    assert thread["my_role"] == "buyer" and thread["closed"] is False
    assert [(m["sender_role"], m["mine"]) for m in thread["messages"]] == [
        ("buyer", True),
        ("merchant", False),
        ("admin", False),
    ]
    # Polling only returns newer messages.
    last = thread["messages"][-1]["id"]
    assert (
        _client(db, farmer)
        .get(f"/orders/{order.id}/messages?after_id={last}")
        .json()["messages"]
        == []
    )


def test_nobody_else_can_read_or_write(db, merchant, buyer, order):  # noqa: F811
    _post(_client(db, buyer[0]), order.id, "Private question")
    stranger, _ = _buyer(db, email="stranger@example.com")
    rival = _other_merchant(db)
    rival_owner = db.get(User, rival.user_id)
    for outsider in (stranger, rival_owner):
        client = _client(db, outsider)
        assert client.get(f"/orders/{order.id}/messages").status_code == 404
        assert _post(client, order.id, "let me in").status_code == 404
    assert _client(db, stranger).get("/orders/999/messages").status_code == 404
    assert db.query(ChatMessage).count() == 1


def test_each_message_notifies_the_other_side(db, merchant, buyer, order):  # noqa: F811
    _post(_client(db, buyer[0]), order.id, "Hello farm")
    farmer = db.get(User, merchant.user_id)
    _post(_client(db, farmer), order.id, "Hello buyer")
    kinds = {
        uid: [
            n.title
            for n in db.query(Notification).filter_by(user_id=uid, kind="chat_message")
        ]
        for uid in (buyer[0].id, farmer.id)
    }
    assert kinds[farmer.id] == [f"The buyer wrote about CB-2026-{order.id:04d}"]
    assert kinds[buyer[0].id] == [f"The farm wrote about CB-2026-{order.id:04d}"]
    # A tap opens this order's chat on either side.
    links = {
        n.user_id: n.link for n in db.query(Notification).filter_by(kind="chat_message")
    }
    assert links[buyer[0].id] == f"/chats?order={order.id}"
    assert links[farmer.id] == f"/merchantDashboard?order={order.id}"


def test_chat_closes_seven_days_after_delivery(db, buyer, order):  # noqa: F811
    order.status = "delivered"
    order.delivered_at = datetime.now(UTC) - timedelta(days=6)
    db.commit()
    client = _client(db, buyer[0])
    assert _post(client, order.id, "Thanks!").status_code == 200

    order.delivered_at = datetime.now(UTC) - timedelta(days=7, minutes=1)
    db.commit()
    res = _post(client, order.id, "One more thing")
    assert res.status_code == 403
    thread = client.get(f"/orders/{order.id}/messages").json()
    assert thread["closed"] is True and len(thread["messages"]) == 1  # still readable


def test_blank_and_overlong_messages_are_rejected(db, buyer, order):  # noqa: F811
    client = _client(db, buyer[0])
    assert _post(client, order.id, "   ").status_code == 422
    assert _post(client, order.id, "x" * (chat.MAX_BODY + 1)).status_code == 422


def test_unread_buyer_message_texts_the_farm_once(
    db, merchant, buyer, order, monkeypatch
):  # noqa: F811
    texts = []
    monkeypatch.setattr(chat, "send_sms", lambda **kw: texts.append(kw))
    _post(_client(db, buyer[0]), order.id, "Are you open?")
    now = datetime.now(UTC)

    assert chat.send_unread_merchant_sms(db, now + timedelta(minutes=10)) == 0
    assert chat.send_unread_merchant_sms(db, now + timedelta(minutes=16)) == 1
    assert texts[0]["number"] == merchant.contact_number
    assert (
        chat.send_unread_merchant_sms(db, now + timedelta(minutes=30)) == 0
    )  # once only


def test_read_messages_are_not_texted(db, merchant, buyer, order, monkeypatch):  # noqa: F811
    texts = []
    monkeypatch.setattr(chat, "send_sms", lambda **kw: texts.append(kw))
    _post(_client(db, buyer[0]), order.id, "Are you open?")
    _client(db, db.get(User, merchant.user_id)).get(
        f"/orders/{order.id}/messages"
    )  # farm reads
    assert (
        chat.send_unread_merchant_sms(db, datetime.now(UTC) + timedelta(minutes=20))
        == 0
    )
    assert texts == []


def test_admin_without_two_factor_cannot_read_chat(db, buyer, order, monkeypatch):  # noqa: F811
    # E8c applies here too: admin access needs two-step verification.
    _post(_client(db, buyer[0]), order.id, "Private")
    admin = make_user(db, "admin2@example.com", is_admin=True, two_factor=False)
    db.commit()
    assert _client(db, admin).get(f"/orders/{order.id}/messages").status_code == 404
    set_identity(db, admin, twoFactorEnabled=True)  # turned on in BetterAuth
    # Still refused: this session did not pass the TOTP step (CF-0017).
    assert _client(db, admin).get(f"/orders/{order.id}/messages").status_code == 404
    # Finishing setup gives a new session that did (mfa=true in the token).
    admin.mfa_session = True
    assert _client(db, admin).get(f"/orders/{order.id}/messages").status_code == 200


def test_merchant_chat_list_shows_last_message_and_unread(db, merchant, buyer, order):  # noqa: F811
    farmer = db.get(User, merchant.user_id)
    farm = _client(db, farmer)
    shopper = _client(db, buyer[0])

    # No messages yet: no chat in the list.
    assert farm.get("/merchants/me/chats").json() == []

    _post(shopper, order.id, "Is the talong fresh?")
    _post(shopper, order.id, "And the okra?")
    chats = farm.get("/merchants/me/chats").json()
    assert len(chats) == 1
    assert chats[0]["order_id"] == order.id
    assert chats[0]["last_body"] == "And the okra?"
    assert chats[0]["last_mine"] is False
    assert chats[0]["unread"] == 2

    # Opening the thread marks it read; the farm's own reply is not unread.
    farm.get(f"/orders/{order.id}/messages")
    _post(farm, order.id, "Both harvested today.")
    chats = farm.get("/merchants/me/chats").json()
    assert chats[0]["unread"] == 0 and chats[0]["last_mine"] is True

    # A buyer has no farm, so the list is not theirs to read.
    assert shopper.get("/merchants/me/chats").status_code == 404


def test_buyer_chat_list(db, merchant, buyer, order):  # noqa: F811
    farmer = db.get(User, merchant.user_id)
    farm = _client(db, farmer)
    shopper = _client(db, buyer[0])
    unpaid = Order(
        user_id=buyer[0].id,
        merchant_id=merchant.id,
        status="pending",
        total_price=100,
        items=[],
        ordered_at=datetime(2026, 11, 13, tzinfo=UTC),
    )
    db.add(unpaid)
    db.commit()

    # A paid order with no messages shows, so the buyer can start the chat.
    # An unpaid order does not show.
    chats = shopper.get("/users/me/chats").json()
    assert [c["order_id"] for c in chats] == [order.id]
    assert chats[0]["last_body"] is None and chats[0]["unread"] == 0
    assert chats[0]["farm_name"] == merchant.merchant_name
    assert "farm_logo_url" in chats[0]

    _post(shopper, order.id, "Is the talong fresh?")
    _post(farm, order.id, "Harvested this morning!")
    _post(farm, order.id, "Ships at 3pm.")
    chats = shopper.get("/users/me/chats").json()
    assert chats[0]["last_body"] == "Ships at 3pm."
    assert chats[0]["last_mine"] is False and chats[0]["unread"] == 2

    # Opening the thread marks it read.
    shopper.get(f"/orders/{order.id}/messages")
    assert shopper.get("/users/me/chats").json()[0]["unread"] == 0

    # Another buyer does not see this chat.
    other = make_user(db, "other-buyer@example.com", notifications_preferences={})
    db.add(other)
    db.commit()
    assert _client(db, other).get("/users/me/chats").json() == []

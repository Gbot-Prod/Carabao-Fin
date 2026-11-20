"""Shop inquiries: a buyer can message a farm before (or without) buying."""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import chat as chat_routes
from app.models.chat import ChatMessage, Conversation
from app.models.notification import Notification
from app.models.order import Order
from app.models.user import User
from app.services import chat
from tests.better_auth import make_user
from tests.test_merchant_listings import _other_merchant
from tests.test_reviews import _buyer


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(chat_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _ask(client, merchant_id, body):
    return client.post(
        f"/merchants/{merchant_id}/inquiry/messages", json={"body": body}
    )


def test_buyer_with_no_order_can_ask_and_farm_replies(db, merchant, buyer):
    shopper = _client(db, buyer[0])
    farmer = db.get(User, merchant.user_id)
    farm = _client(db, farmer)
    assert db.query(Order).count() == 0

    # Before the first message there is nothing, but the thread is open.
    thread = shopper.get(f"/merchants/{merchant.id}/inquiry/messages").json()
    assert thread["conversation_id"] is None and thread["closed"] is False
    assert thread["messages"] == [] and thread["my_role"] == "buyer"
    assert db.query(Conversation).count() == 0  # reading creates nothing

    assert _ask(shopper, merchant.id, "Do you deliver to Malolos?").status_code == 200
    inquiries = farm.get("/merchants/me/inquiries").json()
    assert len(inquiries) == 1
    row = inquiries[0]
    assert row["buyer_name"] == "Juan dela Cruz" and row["unread"] == 1
    conv_id = row["conversation_id"]

    farm_thread = farm.get(f"/inquiries/{conv_id}/messages").json()
    assert farm_thread["my_role"] == "merchant"
    reply = farm.post(f"/inquiries/{conv_id}/messages", json={"body": "Yes, Tuesdays."})
    assert reply.status_code == 200

    mine = shopper.get("/users/me/inquiries").json()
    assert [(r["farm_name"], r["last_body"], r["unread"]) for r in mine] == [
        ("Dela Cruz Farm", "Yes, Tuesdays.", 1)
    ]
    # Asking again reuses the same conversation.
    _ask(shopper, merchant.id, "Great, thanks!")
    assert db.query(Conversation).filter_by(kind="shop").count() == 1
    thread = shopper.get(f"/merchants/{merchant.id}/inquiry/messages").json()
    assert [(m["sender_role"], m["mine"]) for m in thread["messages"]] == [
        ("buyer", True),
        ("merchant", False),
        ("buyer", True),
    ]
    # Order chat lists are unchanged by inquiries.
    assert farm.get("/merchants/me/chats").json() == []


def test_each_inquiry_message_notifies_the_other_side(db, merchant, buyer):
    farmer = db.get(User, merchant.user_id)
    _ask(_client(db, buyer[0]), merchant.id, "Hello farm")
    conv = db.query(Conversation).filter_by(kind="shop").one()
    _client(db, farmer).post(f"/inquiries/{conv.id}/messages", json={"body": "Hi!"})
    titles = {
        uid: [
            n.title
            for n in db.query(Notification).filter_by(user_id=uid, kind="chat_message")
        ]
        for uid in (buyer[0].id, farmer.id)
    }
    assert titles[farmer.id] == ["A buyer asked about your farm"]
    assert titles[buyer[0].id] == ["Dela Cruz Farm replied to your question"]
    links = {
        n.user_id: n.link for n in db.query(Notification).filter_by(kind="chat_message")
    }
    assert links[buyer[0].id] == f"/chats?farm={merchant.id}"
    assert links[farmer.id] == f"/merchantDashboard?inquiry={conv.id}"


def test_outsiders_cannot_read_or_write_an_inquiry(db, merchant, buyer):
    _ask(_client(db, buyer[0]), merchant.id, "Private question")
    conv = db.query(Conversation).filter_by(kind="shop").one()
    stranger, _ = _buyer(db, email="stranger@example.com")
    rival = _other_merchant(db)
    rival_owner = db.get(User, rival.user_id)
    for outsider in (stranger, rival_owner):
        client = _client(db, outsider)
        assert client.get(f"/inquiries/{conv.id}/messages").status_code == 404
        res = client.post(f"/inquiries/{conv.id}/messages", json={"body": "hi"})
        assert res.status_code == 404
    # The rival farm doesn't see it in its list either.
    assert _client(db, rival_owner).get("/merchants/me/inquiries").json() == []
    assert db.query(ChatMessage).count() == 1


def test_order_chat_ids_do_not_open_as_inquiries(db, merchant, buyer):
    support = Conversation(kind="support", user_id=buyer[0].id)
    db.add(support)
    db.commit()
    client = _client(db, buyer[0])
    assert client.get(f"/inquiries/{support.id}/messages").status_code == 404


def test_farm_cannot_message_itself(db, merchant):
    farmer = db.get(User, merchant.user_id)
    assert _ask(_client(db, farmer), merchant.id, "me?").status_code == 400


def test_hidden_or_suspended_farm_takes_no_new_inquiries(db, merchant, buyer):
    client = _client(db, buyer[0])
    assert _ask(client, 9999, "anyone?").status_code == 404

    _ask(client, merchant.id, "Before the pause")
    merchant.suspended_at = datetime.now(UTC)
    db.commit()
    res = _ask(client, merchant.id, "Still there?")
    assert res.status_code == 403
    thread = client.get(f"/merchants/{merchant.id}/inquiry/messages").json()
    assert thread["closed"] is True and len(thread["messages"]) == 1

    # A new buyer can't start one with a farm buyers can't see.
    other, _ = _buyer(db, email="other@example.com")
    other_client = _client(db, other)
    assert (
        other_client.get(f"/merchants/{merchant.id}/inquiry/messages").status_code
        == 404
    )
    assert _ask(other_client, merchant.id, "hi").status_code == 404


def test_unread_inquiry_texts_the_farm_once(db, merchant, buyer, monkeypatch):
    texts = []
    monkeypatch.setattr(chat, "send_sms", lambda **kw: texts.append(kw))
    _ask(_client(db, buyer[0]), merchant.id, "Are you open?")
    now = datetime.now(UTC)
    assert chat.send_unread_merchant_sms(db, now + timedelta(minutes=16)) == 1
    assert texts[0]["number"] == merchant.contact_number
    assert "asking about your farm" in texts[0]["message"]
    assert chat.send_unread_merchant_sms(db, now + timedelta(minutes=30)) == 0


def test_admin_can_join_an_inquiry(db, merchant, buyer):
    _ask(_client(db, buyer[0]), merchant.id, "Is this farm legit?")
    conv = db.query(Conversation).filter_by(kind="shop").one()
    admin = make_user(
        db, "admin@example.com", is_admin=True, notifications_preferences={}
    )
    db.add(admin)
    db.commit()
    client = _client(db, admin)
    assert client.get(f"/inquiries/{conv.id}/messages").json()["my_role"] == "admin"
    res = client.post(f"/inquiries/{conv.id}/messages", json={"body": "Yes."})
    assert res.status_code == 200

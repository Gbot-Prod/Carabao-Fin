"""CH2: support chat between a user and the admins."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import support_chat
from app.models.chat import Conversation
from app.models.notification import Notification
from tests.better_auth import make_user
from tests.test_reviews import _buyer, db  # noqa: F401 - fixtures


def _client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(support_chat.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _admin(db, email="admin@example.com"):  # noqa: F811
    # Admins get support notifications only with 2FA on in BetterAuth (E8c).
    admin = make_user(db, email, is_admin=True, two_factor=True)
    db.commit()
    return admin


def test_user_writes_admin_replies(db):  # noqa: F811
    user, _ = _buyer(db)
    admin = _admin(db)
    me = _client(db, user)
    assert me.get("/support/messages").json()["messages"] == []

    assert (
        me.post("/support/messages", json={"body": "My payment failed"}).status_code
        == 200
    )
    assert (
        me.post("/support/messages", json={"body": "Order CB-2026-0001"}).status_code
        == 200
    )
    assert db.query(Conversation).filter_by(kind="support").count() == 1  # one per user

    staff = _client(db, admin)
    [conv] = staff.get("/admin/support").json()
    assert conv["user_email"] == "buyer@example.com" and conv["unread"] == 2
    assert conv["last_message"] == "Order CB-2026-0001"

    thread = staff.get(f"/admin/support/{conv['conversation_id']}/messages").json()
    assert [m["sender_role"] for m in thread["messages"]] == ["user", "user"]
    assert (
        staff.post(
            f"/admin/support/{conv['conversation_id']}/messages",
            json={"body": "Refund on its way"},
        ).status_code
        == 200
    )
    assert staff.get("/admin/support").json()[0]["unread"] == 0

    mine = me.get("/support/messages").json()["messages"]
    assert [(m["sender_role"], m["mine"]) for m in mine] == [
        ("user", True),
        ("user", True),
        ("admin", False),
    ]


def test_notifications_both_ways(db):  # noqa: F811
    user, _ = _buyer(db)
    admin = _admin(db)
    _client(db, user).post("/support/messages", json={"body": "Help please"})
    assert (
        db.query(Notification)
        .filter_by(user_id=admin.id, kind="support_message")
        .count()
        == 1
    )
    conv = db.query(Conversation).filter_by(kind="support").one()
    _client(db, admin).post(
        f"/admin/support/{conv.id}/messages", json={"body": "On it"}
    )
    assert (
        db.query(Notification).filter_by(user_id=user.id, kind="support_reply").count()
        == 1
    )


def test_users_only_see_their_own_support_chat(db):  # noqa: F811
    alice, _ = _buyer(db, email="alice@example.com")
    bob, _ = _buyer(db, email="bob@example.com")
    _client(db, alice).post("/support/messages", json={"body": "Alice's private issue"})
    assert _client(db, bob).get("/support/messages").json()["messages"] == []
    conv = db.query(Conversation).filter_by(kind="support").one()
    bob_client = _client(db, bob)
    assert bob_client.get("/admin/support").status_code == 403
    assert bob_client.get(f"/admin/support/{conv.id}/messages").status_code == 403
    assert (
        bob_client.post(
            f"/admin/support/{conv.id}/messages", json={"body": "x"}
        ).status_code
        == 403
    )


def test_order_conversations_are_not_reachable_as_support(db):  # noqa: F811
    admin = _admin(db)
    order_conv = Conversation(kind="order")
    db.add(order_conv)
    db.commit()
    assert (
        _client(db, admin).get(f"/admin/support/{order_conv.id}/messages").status_code
        == 404
    )

"""A3: admins suspend and reinstate accounts."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin, auth, merchants, users
from app.core.security import create_access_token
from app.models.mobile_credential import MobileCredential
from app.models.produce import Produce
from app.models.user import User
from tests.test_reviews import db, merchant  # noqa: F401 - fixtures

SECRET = "test-secret"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", SECRET)
    monkeypatch.setenv("FASTAPI_JWT_SECRET", "suspension-test-jwt-secret-0123456789")


def _app(db, as_user=None) -> TestClient:
    app = FastAPI()
    for r in (admin.router, auth.router, merchants.router, users.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    if as_user is not None:
        app.dependency_overrides[get_current_user] = lambda: as_user
    return TestClient(app)


def _user(db, email, **fields) -> User:
    user = User(email=email, notifications_preferences={}, **fields)
    db.add(user)
    db.commit()
    return user


def _admin_client(db):
    return _app(db, _user(db, "admin@example.com", is_admin=True))


def _suspend(client, user_id, reason="Fraudulent listings"):
    return client.post(f"/admin/users/{user_id}/suspend", json={"reason": reason})


def test_suspend_records_reason_and_reinstate_clears_it(db, merchant):
    target = _user(db, "buyer@example.com")
    client = _admin_client(db)

    res = _suspend(client, target.id)
    assert res.status_code == 200, res.text
    assert res.json()["suspension_reason"] == "Fraudulent listings"
    assert res.json()["suspended_at"] is not None
    assert _suspend(client, target.id).status_code == 409

    res = client.post(f"/admin/users/{target.id}/reinstate")
    assert res.status_code == 200, res.text
    assert res.json()["suspended_at"] is None
    assert client.post(f"/admin/users/{target.id}/reinstate").status_code == 409


def test_reason_required_and_cannot_suspend_self(db, merchant):
    admin_user = _user(db, "admin@example.com", is_admin=True)
    target = _user(db, "buyer@example.com")
    client = _app(db, admin_user)
    assert _suspend(client, target.id, reason="").status_code == 422
    assert _suspend(client, target.id, reason="   ").status_code == 422
    assert _suspend(client, admin_user.id).status_code == 400
    assert _suspend(client, 999).status_code == 404


def test_non_admin_cannot_suspend(db, merchant):
    target = _user(db, "victim@example.com")
    client = _app(db, _user(db, "buyer@example.com"))
    assert _suspend(client, target.id).status_code == 403


def test_suspended_token_is_rejected(db, merchant):
    target = _user(db, "buyer@example.com", external_auth_id="ba_buyer")
    token = create_access_token(subject="ba_buyer", expires_minutes=5)
    headers = {"Authorization": f"Bearer {token}"}
    plain = _app(db)
    assert plain.get("/users/me", headers=headers).status_code == 200

    _suspend(_admin_client(db), target.id)
    res = plain.get("/users/me", headers=headers)
    assert res.status_code == 403
    assert "Fraudulent listings" in res.json()["detail"]


def test_suspended_user_cannot_sync_web_session(db, merchant):
    target = _user(db, "buyer@example.com", external_auth_id="ba_buyer")
    _suspend(_admin_client(db), target.id)
    res = _app(db).post(
        "/auth/sync",
        json={"provider_user_id": "ba_buyer", "email": "buyer@example.com"},
        headers={"X-Internal-Auth-Sync-Secret": SECRET},
    )
    assert res.status_code == 403


def test_suspended_user_cannot_sign_in_on_mobile(db, merchant):
    target = _user(db, "buyer@example.com", external_auth_id="mobile-user-1")
    db.add(
        MobileCredential(
            user_id=target.id, password_hash=auth._bcrypt_hash("pw-123456")
        )
    )
    db.commit()
    plain = _app(db)
    body = {"email": "buyer@example.com", "password": "pw-123456"}
    assert plain.post("/auth/mobile/sign-in", json=body).status_code == 200

    _suspend(_admin_client(db), target.id)
    assert plain.post("/auth/mobile/sign-in", json=body).status_code == 403


def test_better_auth_user_is_banned_and_sessions_ended(db, merchant):
    db.execute(
        text(
            'CREATE TABLE "user" (id TEXT PRIMARY KEY, banned BOOLEAN, "banReason" TEXT)'
        )
    )
    db.execute(text('CREATE TABLE "session" (id TEXT PRIMARY KEY, "userId" TEXT)'))
    db.execute(text("""INSERT INTO "user" (id, banned) VALUES ('ba_buyer', 0)"""))
    db.execute(
        text("""INSERT INTO "session" (id, "userId") VALUES ('s1', 'ba_buyer')""")
    )
    db.commit()
    target = _user(db, "buyer@example.com", external_auth_id="ba_buyer")
    client = _admin_client(db)

    _suspend(client, target.id)
    row = db.execute(text('SELECT banned, "banReason" FROM "user"')).one()
    assert bool(row[0]) is True and row[1] == "Fraudulent listings"
    assert db.execute(text('SELECT COUNT(*) FROM "session"')).scalar() == 0

    client.post(f"/admin/users/{target.id}/reinstate")
    assert not db.execute(text('SELECT banned FROM "user"')).scalar()


def test_missing_better_auth_table_does_not_block_suspension(db, merchant):
    target = _user(db, "buyer@example.com", external_auth_id="ba_buyer")
    assert _suspend(_admin_client(db), target.id).status_code == 200
    assert db.get(User, target.id).suspended_at is not None


def test_suspended_merchant_is_hidden_from_buyers(db, merchant):
    db.add(Produce(merchant_id=merchant.id, name="Talong", price=80, stock_quantity=5))
    db.commit()
    buyer_view = _app(db)
    assert [m["id"] for m in buyer_view.get("/merchants").json()] == [merchant.id]

    admin_client = _admin_client(db)
    _suspend(admin_client, merchant.user_id)
    assert buyer_view.get("/merchants").json() == []
    assert buyer_view.get(f"/merchants/{merchant.id}").status_code == 404
    assert buyer_view.get(f"/merchants/{merchant.id}/produce").status_code == 404

    listed = admin_client.get("/admin/merchants").json()["items"]
    assert listed[0]["owner_suspension_reason"] == "Fraudulent listings"

    admin_client.post(f"/admin/users/{merchant.user_id}/reinstate")
    assert buyer_view.get(f"/merchants/{merchant.id}/produce").status_code == 200

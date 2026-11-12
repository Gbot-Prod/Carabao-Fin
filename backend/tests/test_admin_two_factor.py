"""E8c: admins need two-step verification for the admin API."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin, auth
from app.models.user import User
from tests.test_reviews import db  # noqa: F401 - fixture

SECRET = "two-factor-test-secret"


def _admin_client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(admin.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _admin(db, **fields) -> User:  # noqa: F811
    user = User(
        email="admin@example.com", is_admin=True, notifications_preferences={}, **fields
    )
    db.add(user)
    db.commit()
    return user


def test_admin_without_two_factor_is_told_to_turn_it_on(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "true")
    res = _admin_client(db, _admin(db)).get("/admin/stats")
    assert res.status_code == 403
    assert "Two-step verification is required" in res.json()["detail"]


def test_admin_with_two_factor_gets_in(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "true")
    res = _admin_client(db, _admin(db, two_factor_enabled=True)).get("/admin/stats")
    assert res.status_code == 200, res.text


def test_requirement_is_on_by_default_and_can_be_switched_off(monkeypatch):
    monkeypatch.delenv("ADMIN_REQUIRE_2FA", raising=False)
    assert admin.admin_requires_two_factor() is True
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "false")
    assert admin.admin_requires_two_factor() is False


def test_non_admin_still_gets_admin_only(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "true")
    buyer = User(
        email="b@example.com", two_factor_enabled=True, notifications_preferences={}
    )
    db.add(buyer)
    db.commit()
    res = _admin_client(db, buyer).get("/admin/stats")
    assert res.status_code == 403 and res.json()["detail"] == "Admin only"


def test_sync_records_the_two_factor_flag(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", SECRET)
    monkeypatch.setenv("FASTAPI_JWT_SECRET", "two-factor-test-jwt-secret-0123456789")
    user = User(
        email="admin@example.com",
        external_auth_id="ba_admin",
        is_admin=True,
        notifications_preferences={},
    )
    db.add(user)
    db.commit()
    app = FastAPI()
    app.include_router(auth.router)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    headers = {"X-Internal-Auth-Sync-Secret": SECRET}
    body = {"provider_user_id": "ba_admin", "email": "admin@example.com"}

    assert (
        client.post(
            "/auth/sync", json={**body, "two_factor_enabled": True}, headers=headers
        ).status_code
        == 200
    )
    db.expire_all()
    assert db.get(User, user.id).two_factor_enabled is True

    # Omitted: unchanged. False: turned off.
    client.post("/auth/sync", json=body, headers=headers)
    db.expire_all()
    assert db.get(User, user.id).two_factor_enabled is True
    client.post(
        "/auth/sync", json={**body, "two_factor_enabled": False}, headers=headers
    )
    db.expire_all()
    assert db.get(User, user.id).two_factor_enabled is False

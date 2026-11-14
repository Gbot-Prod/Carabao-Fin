"""E8c: admins need two-step verification for the admin API."""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin
from app.models.user import User
from tests.better_auth import make_user
from tests.test_reviews import db  # noqa: F401 - fixture
from tests.tokens import bearer, trust_test_key


def _admin_client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(admin.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _admin(db, two_factor=False) -> User:  # noqa: F811
    """An admin whose BetterAuth user has 2FA on or off."""
    user = make_user(db, "admin@example.com", is_admin=True, two_factor=two_factor)
    db.commit()
    return user


def test_admin_without_two_factor_is_told_to_turn_it_on(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "true")
    res = _admin_client(db, _admin(db)).get("/admin/stats")
    assert res.status_code == 403
    assert "Two-step verification is required" in res.json()["detail"]


def test_admin_with_two_factor_gets_in(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "true")
    res = _admin_client(db, _admin(db, two_factor=True)).get("/admin/stats")
    assert res.status_code == 200, res.text


def test_requirement_is_on_by_default_and_can_be_switched_off(monkeypatch):
    monkeypatch.delenv("ADMIN_REQUIRE_2FA", raising=False)
    assert admin.admin_requires_two_factor() is True
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "false")
    assert admin.admin_requires_two_factor() is False


def test_non_admin_still_gets_admin_only(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "true")
    buyer = make_user(db, "b@example.com", two_factor=True)
    db.commit()
    res = _admin_client(db, buyer).get("/admin/stats")
    assert res.status_code == 403 and res.json()["detail"] == "Admin only"


def test_two_factor_is_read_live_from_better_auth(db, monkeypatch):  # noqa: F811
    trust_test_key(monkeypatch)
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "true")
    make_user(
        db, "admin@example.com", identity_id="ba_admin", is_admin=True, two_factor=True
    )
    db.commit()
    app = FastAPI()
    app.include_router(admin.router)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    def stats(**claims):
        return client.get(
            "/admin/stats",
            headers=bearer(sub="ba_admin", email="admin@example.com", **claims),
        ).status_code

    assert stats() == 200
    # Turned off in BetterAuth: access ends at once, even with a token that was
    # issued while it was on.
    db.execute(text('UPDATE "user" SET "twoFactorEnabled" = 0'))
    db.commit()
    assert stats(twoFactorEnabled=True) == 403


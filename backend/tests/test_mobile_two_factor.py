"""E8d: mobile sign-in can't skip two-step verification."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.dependencies import get_db
from app.api.routes import auth
from app.models.mobile_credential import MobileCredential
from app.models.user import User
from tests.test_reviews import db  # noqa: F401 - fixture


@pytest.fixture
def client(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("FASTAPI_JWT_SECRET", "mobile-2fa-test-jwt-secret-0123456789")
    app = FastAPI()
    app.include_router(auth.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _user(db, **fields):  # noqa: F811
    user = User(email="farmer@example.com", notifications_preferences={}, **fields)
    db.add(user)
    db.flush()
    db.add(
        MobileCredential(
            user_id=user.id, password_hash=auth._bcrypt_hash("right-password")
        )
    )
    db.commit()
    return user


def _sign_in(client):
    return client.post(
        "/auth/mobile/sign-in",
        json={"email": "farmer@example.com", "password": "right-password"},
    )


def test_account_without_two_factor_signs_in(db, client):  # noqa: F811
    _user(db, external_auth_id="ba_1")
    assert _sign_in(client).status_code == 200


def test_synced_flag_blocks_password_only_sign_in(db, client):  # noqa: F811
    _user(db, external_auth_id="ba_1", two_factor_enabled=True)
    res = _sign_in(client)
    assert res.status_code == 403
    assert "two-step verification" in res.json()["detail"]
    assert "access_token" not in res.json()


def test_better_auth_flag_blocks_even_before_a_sync(db, client):  # noqa: F811
    db.execute(text('CREATE TABLE "user" (id TEXT, "twoFactorEnabled" BOOLEAN)'))
    db.execute(text("""INSERT INTO "user" VALUES ('ba_1', 1)"""))
    db.commit()
    _user(db, external_auth_id="ba_1")
    assert _sign_in(client).status_code == 403


def test_wrong_password_is_still_401_not_a_hint(db, client):  # noqa: F811
    _user(db, external_auth_id="ba_1", two_factor_enabled=True)
    res = client.post(
        "/auth/mobile/sign-in",
        json={"email": "farmer@example.com", "password": "wrong-password"},
    )
    assert res.status_code == 401

"""E6: password reset (mobile email OTP; web reset email relay)."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.dependencies import get_db
from app.api.routes import auth, email, sms
from app.models.mobile_credential import MobileCredential
from app.models.user import User
from tests.test_reviews import db  # noqa: F401 - fixture

SECRET = "reset-test-secret"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", SECRET)
    monkeypatch.setenv(
        "FASTAPI_JWT_SECRET", "password-reset-test-jwt-secret-0123456789"
    )
    sms._otp_store.clear()
    yield
    sms._otp_store.clear()


@pytest.fixture
def sent(monkeypatch):
    codes = []
    monkeypatch.setattr(
        auth, "send_password_reset_otp_email", lambda to, otp: codes.append((to, otp))
    )
    return codes


def _client(db) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(auth.router)
    app.include_router(email.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _user(db, email="buyer@example.com", password="old-password", **fields):  # noqa: F811
    user = User(email=email, notifications_preferences={}, **fields)
    db.add(user)
    db.flush()
    db.add(MobileCredential(user_id=user.id, password_hash=auth._bcrypt_hash(password)))
    db.commit()
    return user


def _sign_in(client, email, password):
    return client.post(
        "/auth/mobile/sign-in", json={"email": email, "password": password}
    )


def test_reset_with_emailed_code_changes_the_password(db, sent):  # noqa: F811
    _user(db, external_auth_id="mobile-user-1")
    client = _client(db)

    assert client.post(
        "/auth/mobile/password-reset/request", json={"email": "Buyer@Example.com"}
    ).json() == {"ok": True}
    [(to, otp)] = sent
    assert to == "buyer@example.com" and len(otp) == 6

    res = client.post(
        "/auth/mobile/password-reset/confirm",
        json={
            "email": "buyer@example.com",
            "otp": otp,
            "new_password": "new-password-1",
        },
    )
    assert res.status_code == 200, res.text
    assert _sign_in(client, "buyer@example.com", "new-password-1").status_code == 200
    assert _sign_in(client, "buyer@example.com", "old-password").status_code == 401

    # The code is single-use.
    again = client.post(
        "/auth/mobile/password-reset/confirm",
        json={"email": "buyer@example.com", "otp": otp, "new_password": "another-pass"},
    )
    assert again.status_code == 400


def test_wrong_code_and_short_password_are_rejected(db, sent):  # noqa: F811
    _user(db, external_auth_id="mobile-user-2")
    client = _client(db)
    client.post(
        "/auth/mobile/password-reset/request", json={"email": "buyer@example.com"}
    )
    [(_, otp)] = sent

    short = client.post(
        "/auth/mobile/password-reset/confirm",
        json={"email": "buyer@example.com", "otp": otp, "new_password": "short"},
    )
    assert short.status_code == 400
    wrong = client.post(
        "/auth/mobile/password-reset/confirm",
        json={
            "email": "buyer@example.com",
            "otp": "000000" if otp != "000000" else "111111",
            "new_password": "new-password-1",
        },
    )
    assert wrong.status_code == 400
    assert _sign_in(client, "buyer@example.com", "old-password").status_code == 200


def test_unknown_email_gets_the_same_answer_and_no_email(db, sent):  # noqa: F811
    res = _client(db).post(
        "/auth/mobile/password-reset/request", json={"email": "nobody@example.com"}
    )
    assert res.status_code == 200 and res.json() == {"ok": True}
    assert sent == []


def test_second_request_within_a_minute_is_throttled(db, sent):  # noqa: F811
    _user(db)
    client = _client(db)
    body = {"email": "buyer@example.com"}
    assert (
        client.post("/auth/mobile/password-reset/request", json=body).status_code == 200
    )
    assert (
        client.post("/auth/mobile/password-reset/request", json=body).status_code == 429
    )
    assert len(sent) == 1


def test_reset_also_updates_the_web_password_and_ends_web_sessions(db, sent):  # noqa: F811
    db.execute(
        text(
            'CREATE TABLE account (id TEXT, "userId" TEXT, password TEXT, "updatedAt" TEXT)'
        )
    )
    db.execute(text('CREATE TABLE "session" (id TEXT, "userId" TEXT)'))
    db.execute(text("""INSERT INTO account VALUES ('a1', 'ba_1', 'old:hash', NULL)"""))
    db.execute(text("""INSERT INTO "session" VALUES ('s1', 'ba_1')"""))
    db.commit()
    _user(db, external_auth_id="ba_1")
    client = _client(db)
    client.post(
        "/auth/mobile/password-reset/request", json={"email": "buyer@example.com"}
    )
    [(_, otp)] = sent

    res = client.post(
        "/auth/mobile/password-reset/confirm",
        json={
            "email": "buyer@example.com",
            "otp": otp,
            "new_password": "new-password-1",
        },
    )

    assert res.status_code == 200, res.text
    stored = db.execute(text("SELECT password FROM account")).scalar()
    assert auth._verify_better_auth_password(stored, "new-password-1")
    assert not auth._verify_better_auth_password(stored, "old-password")
    assert db.execute(text('SELECT COUNT(*) FROM "session"')).scalar() == 0


def test_better_auth_hash_matches_the_verifier():
    hashed = auth._better_auth_password_hash("Pässwörd-ﬁ")  # NFKC-normalised
    salt, key = hashed.split(":")
    assert len(salt) == 32 and len(key) == 128
    assert auth._verify_better_auth_password(hashed, "Pässwörd-fi")


def test_web_reset_email_relay_needs_the_shared_secret(db, monkeypatch):  # noqa: F811
    links = []
    monkeypatch.setattr(
        email,
        "send_password_reset_email",
        lambda to, reset_url: links.append((to, reset_url)),
    )
    client = _client(db)
    body = {"to": "buyer@example.com", "reset_url": "https://example.com/reset?token=x"}

    assert client.post("/email/send-password-reset", json=body).status_code == 401
    res = client.post(
        "/email/send-password-reset",
        json=body,
        headers={"X-Internal-Auth-Sync-Secret": SECRET},
    )
    assert res.status_code == 200
    assert links == [("buyer@example.com", "https://example.com/reset?token=x")]

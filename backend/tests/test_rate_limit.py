"""E7: sign-in, sign-up and OTP endpoints are rate limited by IP and identifier."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.dependencies import get_db
from app.api.routes import auth, sms
from app.services import rate_limit
from tests.test_reviews import db  # noqa: F401 - fixture


@pytest.fixture
def client(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "rate-limit-test-secret")
    monkeypatch.setattr(sms, "send_signup_otp_email", lambda **_: None)
    monkeypatch.setattr(auth.time, "sleep", lambda _s: None)  # skip failed-login delay
    sms._otp_store.clear()
    # Unknown emails fall through to the BetterAuth tables on sign-in.
    db.execute(text('CREATE TABLE "user" (id TEXT, name TEXT, email TEXT)'))
    db.execute(
        text('CREATE TABLE account ("userId" TEXT, password TEXT, "updatedAt" TEXT)')
    )
    db.commit()
    app = FastAPI()
    app.include_router(auth.router)
    app.include_router(sms.router)
    app.dependency_overrides[get_db] = lambda: db
    yield TestClient(app)
    sms._otp_store.clear()


def _sign_in(client, email, ip=None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return client.post(
        "/auth/mobile/sign-in",
        json={"email": email, "password": "wrong-password"},
        headers=headers,
    )


def test_sign_in_is_limited_per_email_with_retry_after(client):
    ip_limit, id_limit = rate_limit.LIMITS["sign_in"]
    for _ in range(id_limit.max_hits):
        assert _sign_in(client, "victim@example.com").status_code == 401

    blocked = _sign_in(client, "victim@example.com")
    assert blocked.status_code == 429
    assert 0 < int(blocked.headers["Retry-After"]) <= id_limit.window_seconds
    assert "Too many attempts" in blocked.json()["detail"]
    # Another account from the same IP is still allowed (until the IP limit).
    assert _sign_in(client, "someone-else@example.com").status_code == 401


def test_sign_in_is_limited_per_ip_across_emails(client):
    ip_limit, _ = rate_limit.LIMITS["sign_in"]
    for i in range(ip_limit.max_hits):
        assert _sign_in(client, f"user{i}@example.com").status_code == 401
    assert _sign_in(client, "fresh@example.com").status_code == 429


def test_forwarded_ip_counts_only_when_proxy_is_trusted(client, monkeypatch):
    ip_limit, _ = rate_limit.LIMITS["sign_in"]
    monkeypatch.setenv("RATE_LIMIT_TRUST_PROXY", "true")
    for i in range(ip_limit.max_hits):
        _sign_in(client, f"user{i}@example.com", ip="203.0.113.7")
    assert _sign_in(client, "x@example.com", ip="203.0.113.7").status_code == 429
    assert _sign_in(client, "x@example.com", ip="198.51.100.9").status_code == 401

    rate_limit.reset()
    monkeypatch.setenv("RATE_LIMIT_TRUST_PROXY", "false")
    for i in range(ip_limit.max_hits):
        _sign_in(client, f"user{i}@example.com", ip=f"203.0.113.{i}")
    # Header ignored: all of those came from the same (test client) address.
    assert _sign_in(client, "y@example.com", ip="198.51.100.9").status_code == 429


def test_window_slides(client, monkeypatch):
    _, id_limit = rate_limit.LIMITS["sign_in"]
    clock = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: clock[0])
    for _ in range(id_limit.max_hits):
        _sign_in(client, "victim@example.com")
    assert _sign_in(client, "victim@example.com").status_code == 429
    clock[0] += id_limit.window_seconds + 1
    assert _sign_in(client, "victim@example.com").status_code == 401


def test_rejected_requests_do_not_use_up_the_other_counter(client):
    _, id_limit = rate_limit.LIMITS["sign_in"]
    for _ in range(id_limit.max_hits + 5):
        _sign_in(client, "victim@example.com")
    # 15 requests, but only the 10 accepted ones counted against the IP.
    ip_window = rate_limit._hits["sign_in:ip:testclient"]
    assert len(ip_window) == id_limit.max_hits


def test_otp_send_and_verify_are_limited_per_identifier(client):
    _, send_limit = rate_limit.LIMITS["otp_send"]
    body = {"channel": "email", "identifier": "new@example.com"}
    for _ in range(send_limit.max_hits):
        sms._otp_store.clear()  # step past the 60 s resend cooldown
        assert (
            client.post("/auth/signup-verification/request", json=body).status_code
            == 200
        )
    sms._otp_store.clear()
    assert (
        client.post("/auth/signup-verification/request", json=body).status_code == 429
    )

    _, verify_limit = rate_limit.LIMITS["otp_verify"]
    attempt = {**body, "otp": "000000"}
    for _ in range(verify_limit.max_hits):
        assert (
            client.post("/auth/signup-verification/verify", json=attempt).status_code
            == 400
        )
    assert (
        client.post("/auth/signup-verification/verify", json=attempt).status_code == 429
    )


def test_sign_up_is_limited_per_ip(client):
    ip_limit, _ = rate_limit.LIMITS["sign_up"]
    for i in range(ip_limit.max_hits):
        res = client.post(
            "/auth/mobile/sign-up", json={"email": f"n{i}@example.com", "password": "x"}
        )
        assert res.status_code == 400  # too short, but counted
    res = client.post(
        "/auth/mobile/sign-up", json={"email": "last@example.com", "password": "x"}
    )
    assert res.status_code == 429
    assert "Retry-After" in res.headers


def test_password_reset_endpoints_are_limited(client, monkeypatch):
    monkeypatch.setattr(auth, "send_password_reset_otp_email", lambda *_: None)
    _, verify_limit = rate_limit.LIMITS["otp_verify"]
    body = {"email": "a@example.com", "otp": "000000", "new_password": "long-enough-1"}
    for _ in range(verify_limit.max_hits):
        assert (
            client.post("/auth/mobile/password-reset/confirm", json=body).status_code
            == 400
        )
    assert (
        client.post("/auth/mobile/password-reset/confirm", json=body).status_code == 429
    )

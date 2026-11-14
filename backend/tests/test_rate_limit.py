"""E7: the OTP endpoints are rate limited by IP and identifier.

Sign-in and sign-up are BetterAuth's (lib/auth.ts rateLimit); these cover the
backend limiter through the signup-verification endpoints.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import sms
from app.services import rate_limit


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "rate-limit-test-secret")
    monkeypatch.setattr(sms, "send_signup_otp_email", lambda **_: None)
    sms._otp_store.clear()
    app = FastAPI()
    app.include_router(sms.router)
    yield TestClient(app)
    sms._otp_store.clear()


def _verify(client, email, ip=None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return client.post(
        "/auth/signup-verification/verify",
        json={"channel": "email", "identifier": email, "otp": "000000"},
        headers=headers,
    )


def test_limited_per_identifier_with_retry_after(client):
    _, id_limit = rate_limit.LIMITS["otp_verify"]
    for _ in range(id_limit.max_hits):
        assert _verify(client, "victim@example.com").status_code == 400

    blocked = _verify(client, "victim@example.com")
    assert blocked.status_code == 429
    assert 0 < int(blocked.headers["Retry-After"]) <= id_limit.window_seconds
    assert "Too many attempts" in blocked.json()["detail"]
    # Another identifier from the same IP is still allowed (until the IP limit).
    assert _verify(client, "someone-else@example.com").status_code == 400


def test_limited_per_ip_across_identifiers(client):
    ip_limit, _ = rate_limit.LIMITS["otp_verify"]
    for i in range(ip_limit.max_hits):
        assert _verify(client, f"user{i}@example.com").status_code == 400
    assert _verify(client, "fresh@example.com").status_code == 429


def test_forwarded_ip_counts_only_when_proxy_is_trusted(client, monkeypatch):
    ip_limit, _ = rate_limit.LIMITS["otp_verify"]
    monkeypatch.setenv("RATE_LIMIT_TRUST_PROXY", "true")
    for i in range(ip_limit.max_hits):
        _verify(client, f"user{i}@example.com", ip="203.0.113.7")
    assert _verify(client, "x@example.com", ip="203.0.113.7").status_code == 429
    assert _verify(client, "x@example.com", ip="198.51.100.9").status_code == 400

    rate_limit.reset()
    monkeypatch.setenv("RATE_LIMIT_TRUST_PROXY", "false")
    for i in range(ip_limit.max_hits):
        _verify(client, f"user{i}@example.com", ip=f"203.0.113.{i}")
    # Header ignored: all of those came from the same (test client) address.
    assert _verify(client, "y@example.com", ip="198.51.100.9").status_code == 429


def test_window_slides(client, monkeypatch):
    _, id_limit = rate_limit.LIMITS["otp_verify"]
    clock = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: clock[0])
    for _ in range(id_limit.max_hits):
        _verify(client, "victim@example.com")
    assert _verify(client, "victim@example.com").status_code == 429
    clock[0] += id_limit.window_seconds + 1
    assert _verify(client, "victim@example.com").status_code == 400


def test_rejected_requests_do_not_use_up_the_other_counter(client):
    _, id_limit = rate_limit.LIMITS["otp_verify"]
    for _ in range(id_limit.max_hits + 5):
        _verify(client, "victim@example.com")
    # 15 requests, but only the 10 accepted ones counted against the IP.
    ip_window = rate_limit._hits["otp_verify:ip:testclient"]
    assert len(ip_window) == id_limit.max_hits


def test_otp_send_is_limited_per_identifier(client):
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

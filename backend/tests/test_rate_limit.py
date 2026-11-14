"""E7: the OTP endpoints are rate limited by IP and identifier.

Sign-in, sign-up and BetterAuth's phone OTP endpoints are limited per IP by
BetterAuth (lib/auth.ts rateLimit); these cover the backend limiter through the
merchant contact-number OTP and the account OTP sender.
"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.api.routes import sms
from app.services import rate_limit

SECRET = "rate-limit-test-secret"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", SECRET)
    monkeypatch.setattr(sms, "semaphore_send_otp", lambda *, code, **_: code)
    sms._otp_store.clear()
    app = FastAPI()
    app.include_router(sms.router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
    yield TestClient(app)
    sms._otp_store.clear()


def _number(i: int) -> str:
    return f"0917{i:07d}"


def _verify(client, number, ip=None):
    headers = {"X-Forwarded-For": ip} if ip else {}
    return client.post(
        "/sms/otp/verify", json={"number": number, "otp": "000000"}, headers=headers
    )


def test_limited_per_identifier_with_retry_after(client):
    _, id_limit = rate_limit.LIMITS["otp_verify"]
    for _ in range(id_limit.max_hits):
        assert _verify(client, _number(1)).status_code == 400

    blocked = _verify(client, _number(1))
    assert blocked.status_code == 429
    assert 0 < int(blocked.headers["Retry-After"]) <= id_limit.window_seconds
    assert "Too many attempts" in blocked.json()["detail"]
    # Another identifier from the same IP is still allowed (until the IP limit).
    assert _verify(client, _number(2)).status_code == 400


def test_limited_per_ip_across_identifiers(client):
    ip_limit, _ = rate_limit.LIMITS["otp_verify"]
    for i in range(ip_limit.max_hits):
        assert _verify(client, _number(i)).status_code == 400
    assert _verify(client, _number(999)).status_code == 429


def test_forwarded_ip_counts_only_when_proxy_is_trusted(client, monkeypatch):
    ip_limit, _ = rate_limit.LIMITS["otp_verify"]
    monkeypatch.setenv("RATE_LIMIT_TRUST_PROXY", "true")
    for i in range(ip_limit.max_hits):
        _verify(client, _number(i), ip="203.0.113.7")
    assert _verify(client, _number(900), ip="203.0.113.7").status_code == 429
    assert _verify(client, _number(900), ip="198.51.100.9").status_code == 400

    rate_limit.reset()
    monkeypatch.setenv("RATE_LIMIT_TRUST_PROXY", "false")
    for i in range(ip_limit.max_hits):
        _verify(client, _number(i), ip=f"203.0.113.{i}")
    # Header ignored: all of those came from the same (test client) address.
    assert _verify(client, _number(901), ip="198.51.100.9").status_code == 429


def test_window_slides(client, monkeypatch):
    _, id_limit = rate_limit.LIMITS["otp_verify"]
    clock = [1000.0]
    monkeypatch.setattr(rate_limit.time, "monotonic", lambda: clock[0])
    for _ in range(id_limit.max_hits):
        _verify(client, _number(1))
    assert _verify(client, _number(1)).status_code == 429
    clock[0] += id_limit.window_seconds + 1
    assert _verify(client, _number(1)).status_code == 400


def test_rejected_requests_do_not_use_up_the_other_counter(client):
    _, id_limit = rate_limit.LIMITS["otp_verify"]
    for _ in range(id_limit.max_hits + 5):
        _verify(client, _number(1))
    # 15 requests, but only the 10 accepted ones counted against the IP.
    ip_window = rate_limit._hits["otp_verify:ip:testclient"]
    assert len(ip_window) == id_limit.max_hits


def test_account_otps_are_limited_per_number(client):
    limit = rate_limit.IDENTIFIER_LIMITS["account_otp"]

    def send(number):
        return client.post(
            "/internal/sms/account-otp",
            json={"phone_number": number, "code": "123456"},
            headers={"X-Internal-Auth-Sync-Secret": SECRET},
        )

    for _ in range(limit.max_hits):
        assert send("+639170000001").status_code == 200
    # Same number written differently still counts as the same number.
    blocked = send("09170000001")
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) > 0
    assert send("+639170000002").status_code == 200

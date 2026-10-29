from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.api.routes import sms
from app.services.phone_verification import read_token

NUMBER = "+63 912 345 6789"
NORMALIZED = "639123456789"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "test-secret")
    sms._otp_store.clear()
    sms._user_send_log.clear()


@pytest.fixture
def sent(monkeypatch):
    messages = []

    def fake_send(*, number, message, **_):
        messages.append((number, message))
        return [{"status": "Queued"}]

    monkeypatch.setattr(sms, "semaphore_send_sms", fake_send)
    return messages


def _client(user_id: int | None = 1) -> TestClient:
    app = FastAPI()
    app.include_router(sms.router)
    if user_id is not None:
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_id)
    return TestClient(app)


def _last_otp(sent) -> str:
    return sent[-1][1].split("code is ")[1][:6]


def test_raw_relay_routes_removed():
    paths = {route.path for route in sms.router.routes}
    assert "/sms/semaphore/send" not in paths
    assert "/sms/delivery-notification" not in paths


def test_otp_send_requires_auth(sent):
    resp = _client(user_id=None).post("/sms/otp/send", json={"number": NUMBER})
    assert resp.status_code == 401
    assert sent == []


def test_otp_send_rejects_non_ph_number(sent):
    resp = _client().post("/sms/otp/send", json={"number": "+1 555 123 4567"})
    assert resp.status_code == 400
    assert sent == []


def test_otp_send_cooldown(sent):
    client = _client()
    assert client.post("/sms/otp/send", json={"number": NUMBER}).status_code == 200
    assert client.post("/sms/otp/send", json={"number": NUMBER}).status_code == 429
    assert len(sent) == 1
    assert sent[0][0] == NORMALIZED


def test_otp_send_hourly_cap_per_user(sent):
    client = _client()
    for i in range(sms._OTP_USER_HOURLY_LIMIT):
        resp = client.post("/sms/otp/send", json={"number": f"0912345678{i}"})
        assert resp.status_code == 200
    resp = client.post("/sms/otp/send", json={"number": "09998887777"})
    assert resp.status_code == 429
    assert len(sent) == sms._OTP_USER_HOURLY_LIMIT


def test_otp_verify_returns_token_bound_to_user_and_number(sent):
    client = _client(user_id=7)
    client.post("/sms/otp/send", json={"number": NUMBER})
    resp = client.post("/sms/otp/verify", json={"number": NUMBER, "otp": _last_otp(sent)})
    assert resp.status_code == 200
    data = read_token(resp.json()["verification_token"])
    assert data["purpose"] == "merchant_phone"
    assert data["user_id"] == 7
    assert data["number"] == NORMALIZED


def test_otp_is_scoped_to_requesting_user(sent):
    _client(user_id=1).post("/sms/otp/send", json={"number": NUMBER})
    resp = _client(user_id=2).post(
        "/sms/otp/verify", json={"number": NUMBER, "otp": _last_otp(sent)}
    )
    assert resp.status_code == 400


def test_otp_verify_attempt_limit(sent):
    client = _client()
    client.post("/sms/otp/send", json={"number": NUMBER})
    otp = _last_otp(sent)
    wrong = "000000" if otp != "000000" else "111111"
    for _ in range(sms._OTP_MAX_ATTEMPTS):
        resp = client.post("/sms/otp/verify", json={"number": NUMBER, "otp": wrong})
        assert resp.status_code == 400
    # Even the correct code is refused once attempts are exhausted
    resp = client.post("/sms/otp/verify", json={"number": NUMBER, "otp": otp})
    assert resp.status_code == 400
    assert "Too many" in resp.json()["detail"]


def test_semaphore_error_details_not_leaked(monkeypatch):
    def failing_send(**_):
        raise sms.SemaphoreError("Semaphore error: {'apikey': 'secret-ish'}")

    monkeypatch.setattr(sms, "semaphore_send_sms", failing_send)
    resp = _client().post("/sms/otp/send", json={"number": NUMBER})
    assert resp.status_code == 502
    assert "apikey" not in resp.text


def test_signup_token_still_readable_by_auth_route(sent):
    from app.api.routes.auth import _verified_signup_identifier

    client = _client(user_id=None)
    body = {"channel": "phone", "identifier": NUMBER}
    assert client.post("/auth/signup-verification/request", json=body).status_code == 200
    resp = client.post(
        "/auth/signup-verification/verify", json={**body, "otp": _last_otp(sent)}
    )
    assert resp.status_code == 200
    token = resp.json()["verification_token"]
    assert _verified_signup_identifier(token) == ("phone", NORMALIZED)

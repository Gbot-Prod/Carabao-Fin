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

    def fake_send(*, number, message, code, **_):
        assert "{otp}" in message  # Semaphore fills the placeholder, not us
        messages.append((number, message.replace("{otp}", code)))
        return code

    monkeypatch.setattr(sms, "semaphore_send_otp", fake_send)
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
    resp = client.post(
        "/sms/otp/verify", json={"number": NUMBER, "otp": _last_otp(sent)}
    )
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

    monkeypatch.setattr(sms, "semaphore_send_otp", failing_send)
    resp = _client().post("/sms/otp/send", json={"number": NUMBER})
    assert resp.status_code == 502
    assert "apikey" not in resp.text


def test_stores_code_semaphore_reports_delivered(monkeypatch):
    monkeypatch.setattr(sms, "semaphore_send_otp", lambda **_: "424242")
    client = _client()
    client.post("/sms/otp/send", json={"number": NUMBER})
    resp = client.post("/sms/otp/verify", json={"number": NUMBER, "otp": "424242"})
    assert resp.status_code == 200


def test_signup_verification_routes_removed():
    # Signup OTPs are BetterAuth's phoneNumber plugin now (lib/auth.ts).
    paths = {route.path for route in sms.router.routes}
    assert "/auth/signup-verification/request" not in paths
    assert "/auth/signup-verification/verify" not in paths


def _account_otp(body, secret="test-secret"):
    return _client(user_id=None).post(
        "/internal/sms/account-otp",
        json=body,
        headers={"X-Internal-Auth-Sync-Secret": secret} if secret else {},
    )


def test_account_otp_needs_the_internal_secret(sent):
    body = {"phone_number": NUMBER, "code": "123456"}
    assert _account_otp(body, secret=None).status_code == 401
    assert _account_otp(body, secret="wrong").status_code == 401
    assert sent == []


def test_account_otp_sends_betterauths_code_to_normalized_number(sent):
    resp = _account_otp({"phone_number": NUMBER, "code": "123456"})
    assert resp.status_code == 200
    assert resp.json()["code"] == "123456"
    number, message = sent[-1]
    assert number == NORMALIZED and "verification code is 123456" in message

    _account_otp(
        {"phone_number": NUMBER, "code": "654321", "purpose": "password_reset"}
    )
    assert "password reset code is 654321" in sent[-1][1]


def test_account_otp_reports_the_code_semaphore_used(monkeypatch):
    # lib/auth.ts stores this one so the user's code still works.
    monkeypatch.setattr(sms, "semaphore_send_otp", lambda **_: "424242")
    resp = _account_otp({"phone_number": NUMBER, "code": "123456"})
    assert resp.json()["code"] == "424242"


def test_account_otp_rejects_bad_input(sent):
    assert (
        _account_otp({"phone_number": "+1 555 123 4567", "code": "1"}).status_code
        == 400
    )
    assert _account_otp({"phone_number": NUMBER, "code": "abc"}).status_code == 400
    assert (
        _account_otp({"phone_number": NUMBER, "code": "1", "purpose": "x"}).status_code
        == 422
    )
    assert sent == []

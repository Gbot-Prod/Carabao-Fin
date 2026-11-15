"""E6: password reset. BetterAuth runs it for the web and the app alike; the
backend only relays the reset email."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_db
from app.api.routes import email
from tests.test_reviews import db  # noqa: F401 - fixture

SECRET = "reset-test-secret"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", SECRET)


def _client(db) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(email.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


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

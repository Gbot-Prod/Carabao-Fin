"""CF-0063: the remaining input models refuse unknown fields and over-long
values, and email links are http(s) only and escaped."""

from __future__ import annotations

from typing import Any

import pytest
import resend
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

from app.api.routes import admin, admin_produce, chat, email_otp, sms, stock_alerts
from app.api.routes import email as email_routes
from app.api.routes.merchants import MerchantOrderStatusUpdate
from app.api.routes.support_chat import SupportPost
from app.schemas.admin_order import RecordRefundPayload
from app.schemas.payout import PayoutInfoChange, PayoutInfoUpdate
from app.services import email as email_service

GOOD: list[tuple[type[BaseModel], dict[str, Any]]] = [
    (RecordRefundPayload, {"method": "gcash", "reference": "R-1"}),
    (
        PayoutInfoUpdate,
        {
            "payout_type": "gcash",
            "account_name": "Juan",
            "ewallet_number": "09171234567",
        },
    ),
    (
        PayoutInfoChange,
        {
            "payout_type": "gcash",
            "account_name": "Juan",
            "ewallet_number": "09171234567",
            "code": "123456",
        },
    ),
    (admin.RolePayload, {"is_admin": False}),
    (admin.SuspendPayload, {"reason": "spam"}),
    (admin_produce.HidePayload, {"reason": "fake listing"}),
    (chat.ChatPost, {"body": "hello"}),
    (SupportPost, {"body": "hello"}),
    (email_otp.EmailOTPSendRequest, {"email": "a@example.com"}),
    (email_otp.EmailOTPVerifyRequest, {"email": "a@example.com", "otp": "123456"}),
    (sms.OTPSendRequest, {"number": "09171234567"}),
    (sms.OTPVerifyRequest, {"number": "09171234567", "otp": "123456"}),
    (sms.AccountOTPRequest, {"phone_number": "+639171234567", "code": "123456"}),
    (stock_alerts.ThresholdUpdate, {"low_stock_threshold": 5}),
    (MerchantOrderStatusUpdate, {"status": "processing"}),
    (
        email_routes.VerificationEmailPayload,
        {"to": "a@example.com", "verification_url": "https://carabao.ph/verify?t=1"},
    ),
    (
        email_routes.PasswordResetEmailPayload,
        {"to": "a@example.com", "reset_url": "http://localhost:3000/reset?t=1"},
    ),
]


@pytest.mark.parametrize("model, body", GOOD, ids=[m.__name__ for m, _ in GOOD])
def test_known_fields_pass_and_unknown_fields_are_refused(
    model: type[BaseModel], body: dict[str, Any]
) -> None:
    model.model_validate(body)  # what the web and mobile apps send
    for extra in ({"user_id": 2}, {"is_admin": True}, {"status": "delivered"}):
        if set(extra) & set(body):
            continue
        with pytest.raises(ValidationError):
            model.model_validate({**body, **extra})


@pytest.mark.parametrize(
    "model, body",
    [
        (
            PayoutInfoUpdate,
            {
                "payout_type": "bank",
                "bank_code": "B" * 21,
                "account_name": "J",
                "account_number": "1",
            },
        ),
        (
            PayoutInfoUpdate,
            {
                "payout_type": "bank",
                "bank_code": "BDO",
                "account_name": "J",
                "account_number": "1" * 41,
            },
        ),
        (
            PayoutInfoUpdate,
            {
                "payout_type": "gcash",
                "account_name": "J" * 101,
                "ewallet_number": "09171234567",
            },
        ),
        (
            PayoutInfoUpdate,
            {"payout_type": "gcash", "account_name": "J", "ewallet_number": "0" * 21},
        ),
        (
            PayoutInfoChange,
            {
                "payout_type": "gcash",
                "account_name": "J",
                "ewallet_number": "09171234567",
                "code": "1" * 13,
            },
        ),
        (sms.OTPSendRequest, {"number": "0" * 21}),
        (sms.OTPVerifyRequest, {"number": "09171234567", "otp": "1" * 13}),
        (sms.AccountOTPRequest, {"phone_number": "+63" + "9" * 20, "code": "1"}),
        (
            email_routes.VerificationEmailPayload,
            {"to": "a@example.com", "verification_url": "javascript:alert(1)"},
        ),
        (
            email_routes.VerificationEmailPayload,
            {"to": "a@example.com", "verification_url": "//evil.example/x"},
        ),
        (
            email_routes.PasswordResetEmailPayload,
            {"to": "a@example.com", "reset_url": "https://x/" + "a" * 2000},
        ),
    ],
)
def test_over_long_or_unsafe_values_are_refused(
    model: type[BaseModel], body: dict[str, Any]
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(body)


def test_verification_link_is_escaped_in_the_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[dict[str, Any]] = []
    monkeypatch.setattr(resend.Emails, "send", lambda p: sent.append(p))

    email_service.send_verification_email(
        "a@example.com", 'https://carabao.ph/v?t=1&x="><img src=x onerror=alert(1)>'
    )

    html = sent[0]["html"]
    assert '"><img' not in html
    assert "&quot;&gt;&lt;img" in html
    assert 'href="https://carabao.ph/v?t=1&amp;x=' in html


def test_email_route_refuses_unknown_field_with_the_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "s3cret")
    calls: list[Any] = []
    monkeypatch.setattr(
        email_routes, "send_verification_email", lambda **k: calls.append(k)
    )
    app = FastAPI()
    app.include_router(email_routes.router)
    client = TestClient(app)
    headers = {"X-Internal-Auth-Sync-Secret": "s3cret"}
    body = {"to": "a@example.com", "verification_url": "https://carabao.ph/v?t=1"}

    assert (
        client.post("/email/send-verification", json=body, headers=headers).status_code
        == 200
    )
    bad = {**body, "cc": "attacker@example.com"}
    assert (
        client.post("/email/send-verification", json=bad, headers=headers).status_code
        == 422
    )
    assert len(calls) == 1

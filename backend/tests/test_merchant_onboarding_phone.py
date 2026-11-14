"""Merchant applications need a verified account phone, and the shop's contact
number is proven by being that number or by its own texted code."""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchant_onboarding
from app.services import r2_service
from app.services.phone_verification import sign_token
from tests.better_auth import make_user
from tests.test_reviews import db  # noqa: F401 - fixture

PAYLOAD = {
    "merchant_name": "Bulacan Farm",
    "legal_business_name": "Bulacan Farm",
    "business_type": "individual",
    "tin": "123456789",
    "registration_type": "dti",
    "registration_number": "X1",
    "contact_email": "farm@example.com",
    "contact_number": "09171234567",
    "region": "Region III (Central Luzon)",
    "province": "Bulacan",
    "city": "Malolos",
    "barangay": "Poblacion",
    "address": "12 Rizal St",
    "postal_code": "3000",
    "delivery_time": 2,
    "delivery_price": 50,
    "price_range_min": 10,
    "price_range_max": 100,
    "available_days": ["mon"],
}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "test-secret")
    monkeypatch.setattr(r2_service, "upload_rsbsa_document", lambda *a, **k: "rsbsa/x.pdf")


def _apply(db, user, **overrides):  # noqa: F811
    app = FastAPI()
    app.include_router(merchant_onboarding.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app).post(
        "/merchant-onboarding/me",
        data={"payload": json.dumps({**PAYLOAD, **overrides})},
        files={"rsbsa_file": ("rsbsa.pdf", b"%PDF-1.4", "application/pdf")},
    )


def test_account_without_verified_phone_is_asked_for_one(db):  # noqa: F811
    google_user = make_user(db, "g@example.com", phone_number=None)
    db.commit()
    res = _apply(db, google_user)
    assert res.status_code == 403
    assert res.json()["detail"] == "PHONE_VERIFICATION_REQUIRED"


def test_account_phone_needs_no_second_code(db):  # noqa: F811
    user = make_user(db, "f@example.com", phone_number="+639171234567")
    db.commit()
    assert _apply(db, user).status_code == 200


def test_other_contact_number_needs_its_own_code(db):  # noqa: F811
    user = make_user(db, "f@example.com", phone_number="+639170000000")
    db.commit()
    res = _apply(db, user)
    assert res.status_code == 400
    assert "verify your contact number" in res.json()["detail"]

    token = sign_token(
        {"purpose": "merchant_phone", "user_id": user.id, "number": "639171234567"},
        600,
    )
    assert _apply(db, user, phone_verification_token=token).status_code == 200

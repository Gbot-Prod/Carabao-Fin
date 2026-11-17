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
from tests.files import pdf_bytes

PAYLOAD = {
    "merchant_name": "Bulacan Farm",
    "legal_business_name": "Bulacan Farm",
    "business_type": "Farmer",
    "tin": "123456789",
    "registration_type": "DTI",
    "registration_number": "X1",
    "contact_email": "farm@example.com",
    "contact_number": "09171234567",
    "region": "Region III (Central Luzon)",
    "province": "Bulacan",
    "city": "Malolos",
    "barangay": "Poblacion",
    "address": "12 Rizal St",
    "postal_code": "3000",
    "available_days": ["Mon"],
    "gov_id_type": "Passport",
}


def onboarding_files() -> dict:
    """The two documents the submit needs (RSBSA and a government ID)."""
    return {
        "rsbsa_file": ("rsbsa.pdf", pdf_bytes(), "application/pdf"),
        "gov_id_file": ("id.pdf", pdf_bytes(), "application/pdf"),
    }


def patch_uploads(monkeypatch) -> None:
    uploads = {
        "upload_rsbsa_document": "rsbsa/x.pdf",
        "upload_gov_id_document": "gov-id/x.pdf",
        "delete_private_document": None,
    }
    for name, result in uploads.items():
        monkeypatch.setattr(r2_service, name, lambda *a, _r=result, **k: _r)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "test-secret")
    patch_uploads(monkeypatch)


def _apply(db, user, **overrides):  # noqa: F811
    app = FastAPI()
    app.include_router(merchant_onboarding.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app).post(
        "/merchant-onboarding/me",
        # The account's own verified email needs no code (email tests:
        # test_merchant_onboarding_email.py).
        data={
            "payload": json.dumps(
                {**PAYLOAD, "contact_email": user.email, **overrides}
            )
        },
        files=onboarding_files(),
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

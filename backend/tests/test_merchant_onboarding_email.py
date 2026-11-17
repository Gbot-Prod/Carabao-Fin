"""The shop's contact email is proven by being the account's verified email or
by its own emailed code. The submit also needs a government ID document."""

import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import email_otp, merchant_onboarding
from app.models.merchant_application import MerchantApplication
from app.services import r2_service
from app.services.phone_verification import read_token, sign_token
from tests.better_auth import make_user
from tests.files import pdf_bytes
from tests.test_merchant_onboarding_phone import (
    PAYLOAD,
    onboarding_files,
    patch_uploads,
)

EMAIL = "Farm@Example.com"
NORMALIZED = "farm@example.com"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "test-secret")
    patch_uploads(monkeypatch)


@pytest.fixture
def mailbox(monkeypatch):
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(
        email_otp, "send_contact_email_code", lambda to, code: sent.append((to, code))
    )
    return sent


def _otp_client(db, user_id: int = 1) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(email_otp.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_id)
    return TestClient(app)


def _apply(db, user, files=None, **overrides):  # noqa: F811
    app = FastAPI()
    app.include_router(merchant_onboarding.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app).post(
        "/merchant-onboarding/me",
        data={"payload": json.dumps({**PAYLOAD, **overrides})},
        files=files if files is not None else onboarding_files(),
    )


def _email_token(user_id: int, email: str = NORMALIZED, ttl: int = 600) -> str:
    return sign_token(
        {"purpose": "merchant_email", "user_id": user_id, "email": email}, ttl
    )


# /email/otp/send and /email/otp/verify


def test_code_is_sent_and_verify_returns_a_token(db, mailbox):  # noqa: F811
    client = _otp_client(db)
    assert client.post("/email/otp/send", json={"email": EMAIL}).status_code == 200
    [(to, code)] = mailbox
    assert to == NORMALIZED
    resp = client.post("/email/otp/verify", json={"email": EMAIL, "otp": code})
    assert resp.status_code == 200, resp.text
    token = read_token(resp.json()["verification_token"])
    assert token["purpose"] == "merchant_email"
    assert token["user_id"] == 1
    assert token["email"] == NORMALIZED


def test_resend_has_a_cooldown(db, mailbox):  # noqa: F811
    client = _otp_client(db)
    assert client.post("/email/otp/send", json={"email": EMAIL}).status_code == 200
    assert client.post("/email/otp/send", json={"email": EMAIL}).status_code == 429
    assert len(mailbox) == 1


def test_wrong_code_is_refused(db, mailbox):  # noqa: F811
    client = _otp_client(db)
    client.post("/email/otp/send", json={"email": EMAIL})
    wrong = "000000" if mailbox[0][1] != "000000" else "111111"
    resp = client.post("/email/otp/verify", json={"email": EMAIL, "otp": wrong})
    assert resp.status_code == 400


def test_code_of_another_user_does_not_work(db, mailbox):  # noqa: F811
    _otp_client(db, user_id=1).post("/email/otp/send", json={"email": EMAIL})
    resp = _otp_client(db, user_id=2).post(
        "/email/otp/verify", json={"email": EMAIL, "otp": mailbox[0][1]}
    )
    assert resp.status_code == 400


def test_failed_send_frees_the_cooldown(db, monkeypatch):  # noqa: F811
    def broken(to, code):
        raise RuntimeError("Resend is down")

    monkeypatch.setattr(email_otp, "send_contact_email_code", broken)
    client = _otp_client(db)
    assert client.post("/email/otp/send", json={"email": EMAIL}).status_code == 502
    monkeypatch.setattr(email_otp, "send_contact_email_code", lambda to, code: None)
    assert client.post("/email/otp/send", json={"email": EMAIL}).status_code == 200


# The onboarding submit


def test_account_email_needs_no_code(db):  # noqa: F811
    user = make_user(db, NORMALIZED, phone_number="+639171234567")
    db.commit()
    assert _apply(db, user, contact_email=EMAIL).status_code == 200


def test_unverified_account_email_needs_a_code(db):  # noqa: F811
    user = make_user(
        db, NORMALIZED, phone_number="+639171234567", email_verified=False
    )
    db.commit()
    res = _apply(db, user, contact_email=NORMALIZED)
    assert res.status_code == 400
    assert "verify your contact email" in res.json()["detail"]


def test_other_email_needs_its_own_code(db):  # noqa: F811
    user = make_user(db, "owner@example.com", phone_number="+639171234567")
    db.commit()
    res = _apply(db, user, contact_email=EMAIL)
    assert res.status_code == 400
    assert "verify your contact email" in res.json()["detail"]

    token = _email_token(user.id)
    res = _apply(db, user, contact_email=EMAIL, email_verification_token=token)
    assert res.status_code == 200, res.text
    assert db.query(MerchantApplication).one().contact_email == NORMALIZED


@pytest.mark.parametrize(
    "claims",
    [
        {"purpose": "merchant_phone"},
        {"email": "other@example.com"},
        {"user_id": 999},
    ],
)
def test_token_must_match_purpose_user_and_email(db, claims):  # noqa: F811
    user = make_user(db, "owner@example.com", phone_number="+639171234567")
    db.commit()
    token = sign_token(
        {
            "purpose": "merchant_email",
            "user_id": user.id,
            "email": NORMALIZED,
            **claims,
        },
        600,
    )
    res = _apply(db, user, contact_email=EMAIL, email_verification_token=token)
    assert res.status_code == 400


def test_expired_token_is_refused(db):  # noqa: F811
    user = make_user(db, "owner@example.com", phone_number="+639171234567")
    db.commit()
    token = _email_token(user.id, ttl=-1)
    res = _apply(db, user, contact_email=EMAIL, email_verification_token=token)
    assert res.status_code == 400


def test_gov_id_is_saved(db):  # noqa: F811
    user = make_user(db, NORMALIZED, phone_number="+639171234567")
    db.commit()
    res = _apply(db, user, contact_email=NORMALIZED, gov_id_type="UMID")
    assert res.status_code == 200, res.text
    application = db.query(MerchantApplication).one()
    assert application.gov_id_type == "UMID"
    assert application.gov_id_document_path == "gov-id/x.pdf"
    assert application.gov_id_document_original_name == "id.pdf"
    assert application.gov_id_document_content_type == "application/pdf"
    # The checks do not run yet, and nothing is decided automatically.
    assert application.status == "submitted"
    assert application.check_status is None


def test_gov_id_file_is_required(db):  # noqa: F811
    user = make_user(db, NORMALIZED, phone_number="+639171234567")
    db.commit()
    files = {"rsbsa_file": ("rsbsa.pdf", pdf_bytes(), "application/pdf")}
    assert _apply(db, user, files=files, contact_email=NORMALIZED).status_code == 422


def test_unknown_gov_id_type_is_refused(db):  # noqa: F811
    user = make_user(db, NORMALIZED, phone_number="+639171234567")
    db.commit()
    res = _apply(db, user, contact_email=NORMALIZED, gov_id_type="RSBSA")
    assert res.status_code == 400


def test_failed_gov_id_upload_removes_the_rsbsa_upload(db, monkeypatch):  # noqa: F811
    deleted: list[str] = []

    def broken(*a, **k):
        raise RuntimeError("R2 is down")

    monkeypatch.setattr(r2_service, "upload_gov_id_document", broken)
    monkeypatch.setattr(r2_service, "delete_private_document", deleted.append)
    user = make_user(db, NORMALIZED, phone_number="+639171234567")
    db.commit()
    res = _apply(db, user, contact_email=NORMALIZED)
    assert res.status_code == 502
    assert deleted == ["rsbsa/x.pdf"]
    assert db.query(MerchantApplication).count() == 0

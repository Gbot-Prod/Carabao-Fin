"""CF-0007: TIN and RSBSA number are encrypted, indexed by HMAC, and masked."""

import base64
import json
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchant_onboarding
from app.core import field_crypto
from app.models.merchant_application import MerchantApplication
from app.schemas.merchant_application import (
    AdminMerchantApplicationResponse,
    MerchantApplicationResponse,
)
from tests.better_auth import make_user
from tests.test_merchant_onboarding_phone import (
    PAYLOAD,
    onboarding_files,
    patch_uploads,
)
from tests.test_reviews import db  # noqa: F401 - fixture

# The same TIN as the first account, written without dashes.
VALID_PAYLOAD = {
    **PAYLOAD,
    "business_type": "Farmer",
    "registration_type": "DTI",
    "available_days": ["Mon"],
    "tin": "123456789",
}


def test_roundtrip_and_random_nonce():
    a = field_crypto.encrypt("123-456-789-000", "tin")
    b = field_crypto.encrypt("123-456-789-000", "tin")
    assert a != b and a.startswith("v1:")
    assert field_crypto.decrypt(a, "tin") == "123-456-789-000"


def test_purpose_is_bound():
    ct = field_crypto.encrypt("123456789", "tin")
    with pytest.raises(field_crypto.FieldCryptoError):
        field_crypto.decrypt(ct, "rsbsa_number")


def test_previous_key_still_decrypts(monkeypatch):
    old = field_crypto.encrypt("123456789", "tin")
    old_key = base64.b64encode(b"e" * 32).decode()
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY_PREVIOUS", old_key)
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", base64.b64encode(b"n" * 32).decode())
    field_crypto.reset_keys()
    assert field_crypto.decrypt(old, "tin") == "123456789"


def test_check_keys_passes_with_good_keys():
    field_crypto.check_keys()
    stored = field_crypto.encrypt("123456789", "tin")
    field_crypto.check_keys(stored_sample=stored, purpose="tin")


@pytest.mark.parametrize(
    "name, value",
    [
        ("FIELD_ENCRYPTION_KEY", None),
        ("FIELD_HMAC_KEY", None),
        ("FIELD_ENCRYPTION_KEY", "not-base64!"),
        ("FIELD_ENCRYPTION_KEY", base64.b64encode(b"short").decode()),
        ("FIELD_HMAC_KEY", base64.b64encode(b"e" * 32).decode()),  # same as enc key
    ],
)
def test_check_keys_fails_on_bad_config(monkeypatch, name, value):
    # CF-0021: these errors stop startup instead of causing a 500 later.
    if value is None:
        monkeypatch.delenv(name)
    else:
        monkeypatch.setenv(name, value)
    with pytest.raises(field_crypto.FieldCryptoError):
        field_crypto.check_keys()


def test_check_keys_finds_wrong_key_for_stored_data(monkeypatch):
    # A valid key that did not encrypt the stored data passes the round trip,
    # but the stored sample does not decrypt.
    stored = field_crypto.encrypt("123456789", "tin")
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", base64.b64encode(b"n" * 32).decode())
    with pytest.raises(field_crypto.FieldCryptoError, match="cannot be decrypted"):
        field_crypto.check_keys(stored_sample=stored, purpose="tin")


def test_missing_key_fails_closed(monkeypatch):
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY")
    field_crypto.reset_keys()
    with pytest.raises(field_crypto.FieldCryptoError):
        field_crypto.encrypt("123", "tin")


def test_blind_index_normalizes():
    assert field_crypto.blind_index("123-456-789-000") == field_crypto.blind_index(
        "123456789000"
    )
    assert field_crypto.blind_index("123") != field_crypto.blind_index("124")
    assert field_crypto.blind_index("") is None
    assert field_crypto.blind_index(None) is None


def test_mask():
    assert field_crypto.mask("123-456-789-000") == "***-***-***-000"
    assert field_crypto.mask("03-69-04-012-34567") == "**-**-**-***-**567"
    assert field_crypto.mask(None) is None


def _application(db, user, tin="123-456-789-000", rsbsa="03-69-04-012-34567"):  # noqa: F811
    app = MerchantApplication(
        user_id=user.id,
        merchant_name="Farm",
        legal_business_name="Farm",
        barangay="Poblacion",
        business_type="Farmer",
        tin=tin,
        contact_email="f@example.com",
        contact_number="09171234567",
        rsbsa_number=rsbsa,
        rsbsa_document_path="rsbsa/x.pdf",
        gov_id_type="Passport",
        gov_id_document_path="gov-id/x.pdf",
        region="Region III (Central Luzon)",
        province="Bulacan",
        city="Malolos",
        address="1 St",
        postal_code="3000",
        available_days=["mon"],
        submitted_at=datetime.now(UTC),
    )
    db.add(app)
    db.flush()
    return app


def test_database_holds_only_ciphertext(db):  # noqa: F811
    user = make_user(db, "a@example.com")
    app = _application(db, user)
    db.commit()
    row = db.execute(
        text(
            "SELECT tin, rsbsa_number, tin_hmac FROM merchant_applications "
            "WHERE id = :id"
        ),
        {"id": app.id},
    ).one()
    assert row.tin.startswith("v1:") and "123" not in row.tin
    assert row.rsbsa_number.startswith("v1:")
    assert row.tin_hmac == field_crypto.blind_index("123456789000")
    db.expire_all()
    assert db.get(MerchantApplication, app.id).tin == "123-456-789-000"


def test_owner_sees_masked_admin_sees_full(db):  # noqa: F811
    user = make_user(db, "a@example.com")
    app = _application(db, user)
    owner = MerchantApplicationResponse.model_validate(app).model_dump()
    admin = AdminMerchantApplicationResponse.model_validate(app).model_dump()
    assert owner["tin"] == "***-***-***-000"
    assert owner["rsbsa_number"] == "**-**-**-***-**567"
    assert admin["tin"] == "123-456-789-000"
    assert admin["rsbsa_number"] == "03-69-04-012-34567"


def test_onboarding_rejects_a_tin_used_by_another_account(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "test-secret")
    patch_uploads(monkeypatch)
    first = make_user(db, "a@example.com", phone_number="+639170000001")
    _application(db, first, tin="123-456-789")
    second = make_user(db, "b@example.com", phone_number="+639171234567")
    db.commit()

    api = FastAPI()
    api.include_router(merchant_onboarding.router)
    api.dependency_overrides[get_db] = lambda: db
    api.dependency_overrides[get_current_user] = lambda: second
    res = TestClient(api).post(
        "/merchant-onboarding/me",
        data={"payload": json.dumps({**VALID_PAYLOAD, "contact_email": second.email})},
        files=onboarding_files(),
    )
    assert res.status_code == 409, res.text
    assert "TIN" in res.json()["detail"]

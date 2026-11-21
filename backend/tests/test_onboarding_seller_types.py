"""Merchant onboarding by seller type, tax information and Submit later.

* The seller type decides the name, registration and tax fields; the
  registration agency is derived by the server, so contradictions such as
  Corporation + DTI cannot be submitted.
* Registered types give a TIN with branch code, a VAT status and BIR Form 2303.
* Individual types declare whether they are a small agricultural producer
  (BIR RR No. 12-2023).
* "Submit later" saves step 1 as pending_documents, which cannot be approved
  until the business information is submitted.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchant_onboarding
from app.core.errors import FieldErrors, field_errors_handler
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.services import r2_service
from app.services.receipts import SMALL_PRODUCER_LABEL, build_receipt
from tests.better_auth import make_user
from tests.files import pdf_bytes
from tests.test_audit_log import _client as _admin_client
from tests.test_audit_log import _staff
from tests.test_merchant_onboarding_phone import PAYLOAD, patch_uploads

STEP_ONE = {
    key: PAYLOAD[key]
    for key in (
        "contact_email",
        "contact_number",
        "region",
        "province",
        "city",
        "barangay",
        "address",
        "postal_code",
        "available_days",
    )
}
COMMON_NOW = {
    "submit_mode": "now",
    "merchant_name": "Bulacan Farm",
    "gov_id_type": "Passport",
    "terms_accepted": True,
    "terms_version": "May 21, 2026",
}
PERSON = {"last_name": "Dela Cruz", "first_name": "Juan"}
REGISTERED = {
    "registration_number": "DTI-12345",
    "tin": "123-456-789-000",
    "vat_status": "non_vat",
}

VALID = {
    "individual_farmer": {
        **COMMON_NOW,
        **PERSON,
        "seller_type": "individual_farmer",
        "small_agri_producer": True,
    },
    "sole_proprietor": {
        **COMMON_NOW,
        **PERSON,
        **REGISTERED,
        "seller_type": "sole_proprietor",
        "trade_name": "Juan's Greens",
        "small_agri_producer": False,
    },
    "corporation": {
        **COMMON_NOW,
        **REGISTERED,
        "seller_type": "corporation",
        "company_name": "Bulacan Agri Corp.",
        "trade_name": "Bulacan Fresh",
        "rep_last_name": "Santos",
        "rep_first_name": "Maria",
    },
    "cooperative": {
        **COMMON_NOW,
        **REGISTERED,
        "seller_type": "cooperative",
        "company_name": "Malolos Farmers Multi-Purpose Cooperative",
    },
}
DERIVED_REGISTRATION = {
    "individual_farmer": None,
    "sole_proprietor": "DTI",
    "corporation": "SEC",
    "cooperative": "CDA",
}


def _pdf(name: str) -> tuple[str, bytes, str]:
    return (name, pdf_bytes(), "application/pdf")


def files_for(seller_type: str) -> dict:
    files = {"rsbsa_file": _pdf("rsbsa.pdf"), "gov_id_file": _pdf("id.pdf")}
    if seller_type != "individual_farmer":
        files["bir_cert_file"] = _pdf("2303.pdf")
    return files


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "test-secret")
    patch_uploads(monkeypatch)


@pytest.fixture
def applicant(db):  # noqa: F811
    user = make_user(db, "farm@example.com", phone_number="+639171234567")
    db.commit()
    return user


def _post(db, user, body: dict, files: dict | None):  # noqa: F811
    app = FastAPI()
    app.add_exception_handler(FieldErrors, field_errors_handler)
    app.include_router(merchant_onboarding.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app).post(
        "/merchant-onboarding/me",
        data={"payload": json.dumps({**STEP_ONE, "contact_email": user.email, **body})},
        files=files or {},
    )


def _submit(db, user, seller_type="individual_farmer", files=None, **overrides):
    body = {**VALID[seller_type], **overrides}
    body = {key: value for key, value in body.items() if value is not None}
    return _post(db, user, body, files if files is not None else files_for(seller_type))


def _later(db, user, seller_type="individual_farmer", files=None, **overrides):
    # The shop name is part of step 1, so Submit later sends it too.
    body = {
        "submit_mode": "later",
        "seller_type": seller_type,
        "merchant_name": "Bulacan Farm",
        **overrides,
    }
    return _post(db, user, body, files)


def _review(db, application, status):  # noqa: F811
    # The admin ticks every checklist item they reviewed (Accept needs them).
    db.refresh(application)
    confirmed = [item["id"] for item in application.check_checklist or []]
    return _admin_client(db, _staff(db)).patch(
        f"/admin/merchant-applications/{application.id}",
        json={"status": status, "confirmed_items": confirmed},
    )


# --- each seller type --------------------------------------------------------


@pytest.mark.parametrize("seller_type", list(VALID))
def test_each_seller_type_submits(db, applicant, seller_type):  # noqa: F811
    resp = _submit(db, applicant, seller_type)
    assert resp.status_code == 200, resp.text
    application = db.query(MerchantApplication).one()
    assert application.status == "submitted"
    assert application.submitted_at is not None
    assert application.seller_type == seller_type
    assert application.registration_type == DERIVED_REGISTRATION[seller_type]
    assert application.terms_accepted_at is not None
    assert application.terms_version == "May 21, 2026"
    has_cert = seller_type != "individual_farmer"
    assert (application.bir_cert_document_path is not None) is has_cert
    if has_cert:
        assert application.bir_cert_document_original_name == "2303.pdf"
        assert application.bir_cert_document_content_type == "application/pdf"


@pytest.mark.parametrize(
    ("seller_type", "drop", "message"),
    [
        ("individual_farmer", "last_name", "Last name is required."),
        ("individual_farmer", "first_name", "First name is required."),
        ("sole_proprietor", "trade_name", "Business / trade name is required."),
        ("sole_proprietor", "tin", "TIN is required."),
        ("sole_proprietor", "vat_status", "VAT registration status is required."),
        ("corporation", "company_name", "Company registered name is required."),
        ("corporation", "trade_name", "Business / trade name is required."),
        (
            "corporation",
            "rep_first_name",
            "Representative's first name is required.",
        ),
        ("cooperative", "registration_number", "Registration number is required."),
        ("cooperative", "company_name", "Company registered name is required."),
    ],
)
def test_missing_required_field_per_type(  # noqa: F811
    db, applicant, seller_type, drop, message
):
    resp = _submit(db, applicant, seller_type, **{drop: None})
    assert resp.status_code == 400, resp.text
    assert resp.json()["errors"] == {drop: message}
    assert db.query(MerchantApplication).count() == 0


def test_cooperative_trade_name_is_optional(db, applicant):  # noqa: F811
    assert _submit(db, applicant, "cooperative").status_code == 200
    assert db.query(MerchantApplication).one().trade_name is None


def test_individual_farmer_needs_no_tin_or_registration(db, applicant):  # noqa: F811
    resp = _submit(db, applicant, tin=None)
    assert resp.status_code == 200, resp.text
    application = db.query(MerchantApplication).one()
    assert application.tin is None and application.registration_number is None


def test_individual_farmer_refuses_registered_fields(db, applicant):  # noqa: F811
    resp = _submit(db, applicant, vat_status="non_vat", company_name="X Corp")
    assert resp.status_code == 400
    assert resp.json()["errors"] == {
        "vat_status": "VAT registration status does not apply to this seller type.",
        "company_name": "Company registered name does not apply to this seller type.",
    }


def test_name_limits(db, applicant):  # noqa: F811
    assert _submit(db, applicant, last_name="x" * 81).json()["errors"] == {
        "last_name": "Last name must be at most 80 characters."
    }
    resp = _submit(db, applicant, "corporation", company_name="c" * 256)
    assert resp.json()["errors"] == {
        "company_name": "Company registered name must be at most 255 characters."
    }
    resp = _submit(db, applicant, "corporation", company_name="c" * 255)
    assert resp.status_code == 200, resp.text


def test_legal_business_name_is_computed(db, applicant):  # noqa: F811
    resp = _submit(db, applicant, middle_name="Santos", suffix="Jr.")
    assert resp.status_code == 200, resp.text
    assert resp.json()["legal_business_name"] == "Juan Santos Dela Cruz Jr."


def test_legal_business_name_is_the_company_name(db, applicant):  # noqa: F811
    resp = _submit(db, applicant, "corporation")
    assert resp.status_code == 200, resp.text
    assert resp.json()["legal_business_name"] == "Bulacan Agri Corp."


def test_legal_business_name_cannot_be_sent(db, applicant):  # noqa: F811
    resp = _submit(db, applicant, legal_business_name="Anything")
    assert resp.status_code == 400
    assert resp.json()["errors"] == {
        "legal_business_name": "Unexpected field: legal_business_name."
    }


# --- registration type is derived --------------------------------------------


@pytest.mark.parametrize("sent", ["DTI", "SEC", "CDA", "LGU"])
def test_registration_type_cannot_be_chosen(db, applicant, sent):  # noqa: F811
    resp = _submit(db, applicant, "corporation", registration_type=sent)
    assert resp.status_code == 400
    assert "registration_type" in resp.json()["errors"]
    assert db.query(MerchantApplication).count() == 0


def test_changing_seller_type_clears_unused_fields(db, applicant):  # noqa: F811
    assert _submit(db, applicant, "corporation").status_code == 200
    application = db.query(MerchantApplication).one()
    application.status = "rejected"
    db.commit()

    assert _submit(db, applicant, "individual_farmer").status_code == 200
    db.refresh(application)
    assert application.registration_type is None
    assert application.company_name is None
    assert application.rep_first_name is None
    assert application.vat_status is None
    assert application.bir_cert_document_path is None


# --- small agricultural producer declaration ----------------------------------


@pytest.mark.parametrize("seller_type", ["individual_farmer", "sole_proprietor"])
def test_declaration_is_required_for_individuals(  # noqa: F811
    db, applicant, seller_type
):
    resp = _submit(db, applicant, seller_type, small_agri_producer=None)
    assert resp.status_code == 400
    assert resp.json()["errors"] == {
        "small_agri_producer": ("Small agricultural producer declaration is required.")
    }


@pytest.mark.parametrize("answer", [True, False])
def test_declaration_is_stored_with_its_year(db, applicant, answer):  # noqa: F811
    assert _submit(db, applicant, small_agri_producer=answer).status_code == 200
    application = db.query(MerchantApplication).one()
    assert application.small_agri_producer is answer
    assert application.small_agri_declared_at is not None
    assert application.small_agri_declared_year == application.submitted_at.year


@pytest.mark.parametrize("seller_type", ["corporation", "cooperative"])
def test_declaration_is_refused_for_entities(db, applicant, seller_type):  # noqa: F811
    resp = _submit(db, applicant, seller_type, small_agri_producer=True)
    assert resp.status_code == 400
    assert resp.json()["errors"] == {
        "small_agri_producer": (
            "Small agricultural producer declaration does not apply to this "
            "seller type."
        )
    }


def test_receipt_of_a_declared_seller_is_not_an_invoice():
    def receipt(declared):
        merchant = SimpleNamespace(
            merchant_name="Farm",
            city="Malolos",
            province="Bulacan",
            contact_number=None,
            small_agri_producer=declared,
        )
        order = SimpleNamespace(
            id=1,
            status="delivered",
            ordered_at=None,
            delivery_fee=50,
            total_price=150,
            discount=0,
            merchant=merchant,
            user=None,
            delivery_address=None,
            requested_delivery_date=None,
            delivery_window=None,
            items=[],
            voucher_code=None,
        )
        payment = SimpleNamespace(paid_at=None, status="paid", paymongo_payment_id=None)
        return build_receipt(order, payment)

    assert receipt(True).document_label == SMALL_PRODUCER_LABEL
    assert receipt(False).document_label is None
    assert receipt(None).document_label is None


# --- TIN ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("sent", "stored"),
    [
        ("123-456-789-000", "123-456-789-000"),
        ("123456789000", "123-456-789-000"),
        ("123 456 789 0001", "123-456-789-0001"),
        ("12345678900000", "123-456-789-00000"),
    ],
)
def test_tin_branch_code_format(db, applicant, sent, stored):  # noqa: F811
    resp = _submit(db, applicant, "sole_proprietor", tin=sent)
    assert resp.status_code == 200, resp.text
    application = db.query(MerchantApplication).one()
    # Admins see it in full; the applicant sees it masked.
    assert application.tin == stored
    assert resp.json()["tin"].endswith(stored[-3:])
    assert resp.json()["tin"] != stored


@pytest.mark.parametrize("sent", ["123456789", "123-456-789-00", "1234567890000000"])
def test_tin_without_branch_code_is_refused(db, applicant, sent):  # noqa: F811
    resp = _submit(db, applicant, "sole_proprietor", tin=sent)
    assert resp.status_code == 400
    assert resp.json()["errors"]["tin"].startswith("TIN: must be 9 digits plus")


def test_duplicate_tin_is_refused_in_any_format(db, applicant):  # noqa: F811
    other = make_user(db, "other@example.com", phone_number="+639170000009")
    db.commit()
    first = _submit(
        db, other, "sole_proprietor", tin="123456789000", contact_number="09170000009"
    )
    assert first.status_code == 200, first.text
    resp = _submit(db, applicant, "corporation", tin="123-456-789-000")
    assert resp.status_code == 409
    assert resp.json()["errors"] == {
        "tin": "This TIN is already used by another account."
    }


# --- BIR Form 2303 ------------------------------------------------------------


@pytest.mark.parametrize(
    "seller_type", ["sole_proprietor", "corporation", "cooperative"]
)
def test_bir_certificate_is_required(db, applicant, seller_type):  # noqa: F811
    files = files_for(seller_type)
    del files["bir_cert_file"]
    resp = _submit(db, applicant, seller_type, files=files)
    assert resp.status_code == 422
    assert resp.json()["errors"] == {
        "bir_cert_file": "BIR Certificate of Registration is required."
    }


def test_bir_certificate_does_not_apply_to_farmers(db, applicant):  # noqa: F811
    files = {**files_for("individual_farmer"), "bir_cert_file": _pdf("2303.pdf")}
    resp = _submit(db, applicant, files=files)
    assert resp.status_code == 422
    assert "bir_cert_file" in resp.json()["errors"]


def test_bir_certificate_must_be_an_image_or_pdf(db, applicant):  # noqa: F811
    files = {
        **files_for("corporation"),
        "bir_cert_file": ("2303.txt", b"not a document", "text/plain"),
    }
    resp = _submit(db, applicant, "corporation", files=files)
    assert resp.status_code == 400
    assert resp.json()["errors"] == {
        "bir_cert_file": "BIR Certificate of Registration must be an image or PDF"
    }
    assert db.query(MerchantApplication).count() == 0


def test_resubmit_deletes_the_replaced_bir_certificate(  # noqa: F811
    db, applicant, monkeypatch
):
    assert _submit(db, applicant, "corporation").status_code == 200
    application = db.query(MerchantApplication).one()
    application.status = "rejected"
    application.bir_cert_document_path = "bir-2303/old.pdf"
    db.commit()
    deleted: list[str] = []
    monkeypatch.setattr(r2_service, "delete_private_document", deleted.append)

    assert _submit(db, applicant, "corporation").status_code == 200
    assert "bir-2303/old.pdf" in deleted


def test_switching_to_farmer_deletes_the_bir_certificate(  # noqa: F811
    db, applicant, monkeypatch
):
    assert _submit(db, applicant, "cooperative").status_code == 200
    application = db.query(MerchantApplication).one()
    application.status = "rejected"
    application.bir_cert_document_path = "bir-2303/coop.pdf"
    db.commit()
    deleted: list[str] = []
    monkeypatch.setattr(r2_service, "delete_private_document", deleted.append)

    assert _submit(db, applicant, "individual_farmer").status_code == 200
    assert "bir-2303/coop.pdf" in deleted


def test_a_certificate_a_merchant_still_holds_is_kept(  # noqa: F811
    db, applicant, monkeypatch
):
    """CF-0040: a closed merchant keeps the documents it was approved with."""
    assert _submit(db, applicant, "corporation").status_code == 200
    application = db.query(MerchantApplication).one()
    application.status = "rejected"
    application.bir_cert_document_path = "bir-2303/kept.pdf"
    db.add(
        Merchant(
            verification_status="verified",
            user_id=make_user(db, "closed@example.com").id,
            merchant_name="Closed",
            region="Region III",
            province="Bulacan",
            address="x",
            postal_code="3000",
            available_days=["Mon"],
            operating_hours={},
            seller_type="corporation",
            rsbsa_document_path="rsbsa/c.pdf",
            gov_id_type="Passport",
            gov_id_document_path="gov-id/c.pdf",
            bir_cert_document_path="bir-2303/kept.pdf",
        )
    )
    db.commit()
    deleted: list[str] = []
    monkeypatch.setattr(r2_service, "delete_private_document", deleted.append)

    assert _submit(db, applicant, "corporation").status_code == 200
    assert "bir-2303/kept.pdf" not in deleted


# --- terms ----------------------------------------------------------------------


def test_terms_are_required_on_submit_now(db, applicant):  # noqa: F811
    message = "Accept the Terms of Service and Data Privacy Policy to submit."
    resp = _submit(db, applicant, terms_accepted=False)
    assert resp.status_code == 400
    assert resp.json()["errors"] == {"terms_accepted": message}
    resp = _submit(db, applicant, terms_accepted=None)
    assert resp.json()["errors"] == {"terms_accepted": message}


# --- Submit later -----------------------------------------------------------------


def test_submit_later_flow(db, applicant):  # noqa: F811
    resp = _later(db, applicant, "sole_proprietor")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "pending_documents"
    assert body["submitted_at"] is None
    assert body["seller_type"] == "sole_proprietor"
    assert body["merchant_name"] == "Bulacan Farm"
    application = db.query(MerchantApplication).one()
    assert application.terms_accepted_at is None
    assert application.rsbsa_document_path is None

    # Incomplete: an admin cannot approve (or otherwise decide) it.
    for status in ("approved", "rejected", "clarification", "suspended"):
        resp = _review(db, application, status)
        assert resp.status_code == 409, resp.text
        assert "no business information yet" in resp.json()["detail"]
    db.refresh(application)
    assert application.status == "pending_documents"
    # The Merchant Centre opens at once; the merchant cannot sell yet.
    merchant = db.query(Merchant).one()
    assert application.merchant_id == merchant.id
    assert merchant.verification_status == "setup"
    assert merchant.seller_type == "sole_proprietor"
    assert merchant.vat_status is None

    # Saving again later is fine; it stays incomplete.
    assert _later(db, applicant, "sole_proprietor").status_code == 200

    resp = _submit(db, applicant, "sole_proprietor")
    assert resp.status_code == 200, resp.text
    db.refresh(application)
    assert application.status == "submitted"
    assert application.submitted_at is not None
    db.refresh(merchant)
    assert merchant.verification_status == "under_review"

    assert _review(db, application, "approved").status_code == 200
    # Approval updates the same merchant; it does not create another.
    assert db.query(Merchant).filter(Merchant.user_id == applicant.id).one() is merchant
    db.refresh(merchant)
    assert merchant.verification_status == "verified"
    assert merchant.seller_type == "sole_proprietor"
    assert merchant.vat_status == "non_vat"
    assert merchant.small_agri_producer is False
    assert merchant.bir_cert_document_path == "bir-2303/x.pdf"


def test_submit_later_ignores_business_fields(db, applicant):  # noqa: F811
    resp = _later(db, applicant, merchant_name="Bulacan Farm", tin="123")
    # A malformed value is still refused; a blank one is not.
    assert resp.status_code == 400
    assert "tin" in resp.json()["errors"]
    resp = _later(db, applicant, merchant_name="Bulacan Farm", tin="")
    assert resp.status_code == 200, resp.text
    assert resp.json()["tin"] is None


def test_submit_later_needs_a_shop_name(db, applicant):  # noqa: F811
    resp = _later(db, applicant, merchant_name="")
    assert resp.status_code == 400
    assert resp.json()["errors"] == {"merchant_name": "Merchant name is required."}
    assert db.query(Merchant).count() == 0


def test_submit_later_needs_a_seller_type(db, applicant):  # noqa: F811
    resp = _post(db, applicant, {"submit_mode": "later"}, None)
    assert resp.status_code == 400
    assert resp.json()["errors"] == {"seller_type": "Seller type is required."}


def test_submit_mode_is_required(db, applicant):  # noqa: F811
    resp = _post(db, applicant, {"seller_type": "corporation"}, None)
    assert resp.status_code == 400
    assert resp.json()["errors"] == {
        "submit_mode": "Submit business information is required."
    }


def test_submit_later_sends_no_documents(db, applicant):  # noqa: F811
    resp = _later(db, applicant, files={"rsbsa_file": _pdf("rsbsa.pdf")})
    assert resp.status_code == 422
    assert "rsbsa_file" in resp.json()["errors"]
    assert db.query(MerchantApplication).count() == 0


def test_submit_later_still_needs_verified_contacts(db, applicant):  # noqa: F811
    resp = _later(db, applicant, contact_email="someone-else@example.com")
    assert resp.status_code == 400
    assert resp.json()["errors"] == {
        "contact_email": "Please verify your contact email first."
    }
    resp = _later(db, applicant, contact_number="09998887777")
    assert resp.json()["errors"] == {
        "contact_number": "Please verify your contact number first."
    }
    assert db.query(MerchantApplication).count() == 0


def test_submitted_cannot_go_back_to_pending(db, applicant):  # noqa: F811
    assert _submit(db, applicant).status_code == 200
    resp = _later(db, applicant)
    assert resp.status_code == 409
    assert db.query(MerchantApplication).one().status == "submitted"


def test_admin_lists_incomplete_applications(db, applicant):  # noqa: F811
    assert _later(db, applicant).status_code == 200
    client = _admin_client(db, _staff(db))
    rows = client.get(
        "/admin/merchant-applications", params={"status": "pending_documents"}
    ).json()
    assert [row["status"] for row in rows] == ["pending_documents"]


# --- migration ------------------------------------------------------------------------


def test_migration_backfills_seller_type(db):  # noqa: F811
    path = (
        Path(__file__).parents[1]
        / "alembic/versions/b8d2f4a6c1e3_onboarding_seller_type.py"
    )
    spec = importlib.util.spec_from_file_location("seller_type_migration", path)
    assert spec and spec.loader
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)

    legacy = {
        "Farmer": "individual_farmer",
        "Sole Proprietor": "sole_proprietor",
        "Partnership": "corporation",
        "Corporation": "corporation",
        "Cooperative": "cooperative",
    }
    # The test schema has no business_type (the model dropped it); recreate
    # the old column so the backfill can read it.
    db.execute(
        sa.text("ALTER TABLE merchant_applications ADD COLUMN business_type VARCHAR")
    )
    db.execute(sa.text("ALTER TABLE merchants ADD COLUMN business_type VARCHAR"))
    for index, business_type in enumerate(legacy):
        user = make_user(db, f"legacy{index}@example.com")
        db.flush()
        db.execute(
            sa.text(
                "INSERT INTO merchant_applications (user_id, status, merchant_name, "
                "business_type, contact_email, contact_number, region, province, "
                "city, address, postal_code, available_days, pin_confirmed, "
                "created_at, updated_at) VALUES (:user_id, 'approved', 'Old', "
                ":business_type, 'x@example.com', '+639170000000', 'Region III', "
                "'Bulacan', 'Malolos', 'x', '3000', '[]', 0, CURRENT_TIMESTAMP, "
                "CURRENT_TIMESTAMP)"
            ),
            {"user_id": user.id, "business_type": business_type},
        )
    for sql in mig.BACKFILL:
        db.execute(sa.text(sql))
    rows = db.execute(
        sa.text("SELECT business_type, seller_type, status FROM merchant_applications")
    ).all()
    assert len(rows) == len(legacy)
    for business_type, seller_type, status in rows:
        assert seller_type == legacy[business_type]
        # Approved merchants are not sent back into onboarding.
        assert status == "approved"
    db.rollback()

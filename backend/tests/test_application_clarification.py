"""Clarification, rejection and one-time contact verification.

* Reject and clarification need an admin note; clarification flags sections.
* A clarification resubmit changes only the flagged sections; the others,
  and the documents, stay as sent.
* A contact email or number already saved on the application was verified
  then, so it needs no second code.
* A rejected application starts over: Submit later clears its business
  information and documents.
"""

from __future__ import annotations

from app.models.merchant_application import MerchantApplication
from app.services.phone_verification import normalize_ph_mobile, sign_token
from tests.test_onboarding_seller_types import (  # noqa: F401 - fixtures
    _env,
    _later,
    _review,
    _submit,
    applicant,
)


def _application(db) -> MerchantApplication:
    return db.query(MerchantApplication).one()


def test_reject_and_clarification_need_a_note(db, applicant):  # noqa: F811
    assert _submit(db, applicant).status_code == 200
    application = _application(db)
    assert _review(db, application, "rejected", admin_note=None).status_code == 422
    assert _review(db, application, "clarification", admin_note=" ").status_code == 422
    assert _review(db, application, "clarification", sections=[]).status_code == 422
    db.refresh(application)
    assert application.status == "submitted"


def test_clarification_keeps_the_sections_not_flagged(db, applicant):  # noqa: F811
    assert _submit(db, applicant, "sole_proprietor").status_code == 200
    application = _application(db)
    res = _review(db, application, "clarification", sections=["store"])
    assert res.status_code == 200, res.text
    assert res.json()["clarification_sections"] == ["store"]

    # New values for locked fields are ignored; no documents, no TIN (masked).
    res = _submit(
        db,
        applicant,
        "sole_proprietor",
        files={},
        merchant_name="New Farm Name",
        trade_name="Changed",
        address="Elsewhere",
        tin=None,
    )
    assert res.status_code == 200, res.text
    db.refresh(application)
    assert application.status == "submitted"
    assert application.clarification_sections is None
    assert application.merchant_name == "New Farm Name"
    assert application.trade_name == "Juan's Greens"
    assert application.address == "12 Rizal St"
    assert application.tin == "123-456-789-000"
    assert application.gov_id_document_path == "gov-id/x.pdf"
    assert application.bir_cert_document_path == "bir-2303/x.pdf"


def test_flagged_documents_must_be_sent_again(db, applicant):  # noqa: F811
    assert _submit(db, applicant).status_code == 200
    application = _application(db)
    assert (
        _review(db, application, "clarification", sections=["documents"]).status_code
        == 200
    )

    res = _submit(db, applicant, files={})
    assert res.status_code == 422
    assert "gov_id_file" in res.json()["errors"]
    assert _submit(db, applicant).status_code == 200


def test_clarification_cannot_submit_later(db, applicant):  # noqa: F811
    assert _submit(db, applicant).status_code == 200
    application = _application(db)
    assert (
        _review(db, application, "clarification", sections=["store"]).status_code == 200
    )
    res = _later(db, applicant)
    assert res.status_code == 400
    assert "submit_mode" in res.json()["errors"]


def test_saved_contacts_need_no_second_code(db, applicant):  # noqa: F811
    email = "shop@example.com"
    number = "09181234567"
    email_token = sign_token(
        {"purpose": "merchant_email", "user_id": applicant.id, "email": email}, 600
    )
    phone_token = sign_token(
        {
            "purpose": "merchant_phone",
            "user_id": applicant.id,
            "number": normalize_ph_mobile(number),
        },
        600,
    )
    res = _submit(
        db,
        applicant,
        contact_email=email,
        contact_number=number,
        email_verification_token=email_token,
        phone_verification_token=phone_token,
    )
    assert res.status_code == 200, res.text
    application = _application(db)
    application.status = "rejected"
    db.commit()

    res = _submit(db, applicant, contact_email=email, contact_number=number)
    assert res.status_code == 200, res.text


def test_rejected_application_starts_over(db, applicant):  # noqa: F811
    assert _submit(db, applicant, "corporation").status_code == 200
    application = _application(db)
    assert _review(db, application, "rejected").status_code == 200

    assert _later(db, applicant, "corporation").status_code == 200
    db.refresh(application)
    assert application.status == "pending_documents"
    assert application.company_name is None
    assert application.tin is None
    assert application.registration_type is None
    assert application.gov_id_document_path is None
    assert application.bir_cert_document_path is None

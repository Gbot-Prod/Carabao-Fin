"""Selfie with ID: a required camera photo, its own clarification section, a
duplicate check, and a face-match tick before Accept."""

from __future__ import annotations

import hashlib

from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.services import r2_service
from tests.better_auth import make_user
from tests.files import pdf_bytes, png_bytes
from tests.test_document_checks import _app, _decide, _items, _texts
from tests.test_onboarding_seller_types import (  # noqa: F401 - fixtures
    _env,
    _review,
    _submit,
    applicant,
    files_for,
)

SELFIE = png_bytes((9, 9))


def test_selfie_is_required(db, applicant):  # noqa: F811
    files = files_for("individual_farmer")
    del files["selfie_file"]
    res = _submit(db, applicant, files=files)
    assert res.status_code == 422
    assert "selfie_file" in res.json()["errors"]


def test_selfie_must_be_an_image(db, applicant):  # noqa: F811
    files = {
        **files_for("individual_farmer"),
        "selfie_file": ("selfie.pdf", pdf_bytes(), "application/pdf"),
    }
    res = _submit(db, applicant, files=files)
    assert res.status_code == 400
    assert "selfie_file" in res.json()["errors"]


def test_selfie_only_clarification_keeps_the_documents(
    db,
    applicant,  # noqa: F811
    monkeypatch,
):
    assert _submit(db, applicant).status_code == 200
    application = db.query(MerchantApplication).one()
    res = _review(db, application, "clarification", sections=["selfie"])
    assert res.status_code == 200, res.text

    res = _submit(db, applicant, files={})
    assert res.status_code == 422
    assert set(res.json()["errors"]) == {"selfie_file"}

    # The checks read the kept documents again from R2.
    monkeypatch.setattr(r2_service, "get_private_document", lambda path: b"%PDF-1.4")
    monkeypatch.setattr(
        r2_service, "upload_selfie_document", lambda *a, **k: "selfie/new.png"
    )
    res = _submit(db, applicant, files={"selfie_file": ("s.png", SELFIE, "image/png")})
    assert res.status_code == 200, res.text
    db.refresh(application)
    assert application.selfie_document_path == "selfie/new.png"
    assert application.gov_id_document_path == "gov-id/x.pdf"


def test_same_selfie_file_is_a_duplicate(db, applicant):  # noqa: F811
    other_user = make_user(db, "other@example.com")
    db.flush()
    first = MerchantApplication(
        user_id=other_user.id,
        status="rejected",
        seller_type="individual_farmer",
        contact_email="other@example.com",
        contact_number="+639180000000",
        region="Region III",
        province="Bulacan",
        city="Malolos",
        address="x",
        postal_code="3000",
        available_days=["Mon"],
        selfie_file_sha256=hashlib.sha256(SELFIE).hexdigest(),
    )
    db.add(first)
    db.commit()
    application = _app(db, applicant)
    _texts()
    duplicates = _items(db, application, {"selfie": SELFIE})["duplicates"]
    assert duplicates["result"] == "warn"
    assert duplicates["related_application_ids"] == [first.id]


def test_accept_needs_the_selfie_tick(db, applicant):  # noqa: F811
    application = _app(db, applicant)
    item = {i["id"]: i for i in application.check_checklist}["selfie_matches_id"]
    assert item["result"] == "warn"
    others = [
        i["id"]
        for i in application.check_checklist
        if i["result"] in ("warn", "fail") and i["id"] != "selfie_matches_id"
    ]
    res = _decide(db, application, "approved", confirmed=others)
    assert res.status_code == 409
    assert "Selfie matches the government ID" in res.json()["detail"]
    res = _decide(db, application, "approved", confirmed=[*others, "selfie_matches_id"])
    assert res.status_code == 200, res.text
    # Approval copies the R2 key to the merchant, as with the other documents.
    merchant = db.query(Merchant).filter_by(user_id=applicant.id).one()
    assert merchant.selfie_document_path == "selfie/x.png"

"""The automated review checklist (services/document_checks.py).

Each check gives pass / warn / fail / not_checked with a reason. The admin
ticks the items; Accept needs every warn and fail item ticked (the server
checks it too). Reject and clarification never need the checklist, and checks
that failed to run never block a manual review.
"""

from __future__ import annotations

import hashlib

import pytest
import sqlalchemy as sa

from app.core.field_crypto import blind_index
from app.models.merchant_application import MerchantApplication
from app.services import document_checks, r2_service
from tests.better_auth import make_user
from tests.test_audit_log import _client as _admin_client
from tests.test_audit_log import _staff
from tests.test_onboarding_seller_types import (  # noqa: F401 - fixtures
    _env,
    _submit,
    applicant,
)

GOV = b"%PDF-gov"
RSBSA = b"%PDF-rsbsa"
BIR = b"%PDF-bir"


class FakeExtractor:
    def __init__(self, texts: dict[bytes, str | None]):
        self.texts = texts

    def extract_text(self, data: bytes) -> str | None:
        return self.texts.get(data)


@pytest.fixture(autouse=True)
def _default_extractor():
    yield
    document_checks.set_extractor(document_checks.PypdfExtractor())


def _texts(**texts: str | None) -> None:
    document_checks.set_extractor(
        FakeExtractor(
            {GOV: texts.get("gov"), RSBSA: texts.get("rsbsa"), BIR: texts.get("bir")}
        )
    )


def _items(db, application, documents) -> dict[str, dict]:
    document_checks.run_and_save(db, application, documents)
    db.refresh(application)
    assert application.check_status == "completed"
    return {item["id"]: item for item in application.check_checklist}


def _app(db, applicant, seller_type="individual_farmer", **overrides):  # noqa: F811
    assert _submit(db, applicant, seller_type, **overrides).status_code == 200
    return db.query(MerchantApplication).filter_by(user_id=applicant.id).one()


# --- 1. name vs government ID -------------------------------------------------


@pytest.mark.parametrize(
    ("text", "result"),
    [
        ("REPUBLIC OF THE PHILIPPINES\nDELA CRUZ, JUAN\nN01-12-345678", "pass"),
        ("DELA CRUZ, PEDRO", "warn"),
        ("SANTOS, MARIA", "fail"),
        (None, "not_checked"),
    ],
)
def test_name_matches_government_id(db, applicant, text, result):  # noqa: F811
    application = _app(db, applicant)
    _texts(gov=text, rsbsa="RSBSA")
    items = _items(db, application, {"gov_id": GOV, "rsbsa": RSBSA})
    assert items["name_matches_id"]["result"] == result
    if text:
        assert application.name_match_score is not None
        assert application.ocr_gov_id_name  # encrypted at rest


def test_corporation_compares_the_representative(db, applicant):  # noqa: F811
    application = _app(db, applicant, "corporation")
    _texts(gov="SANTOS, MARIA", rsbsa="x", bir="x")
    items = _items(db, application, {"gov_id": GOV, "rsbsa": RSBSA, "bir_cert": BIR})
    assert items["name_matches_id"]["result"] == "pass"
    assert "representative" in items["name_matches_id"]["reason"]


# --- 2. registration number format --------------------------------------------


@pytest.mark.parametrize(
    ("seller_type", "number", "result"),
    [
        ("sole_proprietor", "1234567", "pass"),
        ("sole_proprietor", "DTI-12345", "warn"),
        ("corporation", "CS201912345", "pass"),
        ("corporation", "12-AB", "warn"),
        ("cooperative", "9520-15005879", "pass"),
        ("cooperative", "COOP-1", "warn"),
    ],
)
def test_registration_format_is_a_warning(db, applicant, seller_type, number, result):  # noqa: F811
    application = _app(db, applicant, seller_type, registration_number=number)
    _texts()
    items = _items(db, application, {"gov_id": GOV, "rsbsa": RSBSA, "bir_cert": BIR})
    assert items["registration_format"]["result"] == result


def test_no_registration_check_for_farmers(db, applicant):  # noqa: F811
    application = _app(db, applicant)
    _texts()
    assert "registration_format" not in _items(db, application, {"gov_id": GOV})


# --- 3. BIR 2303 --------------------------------------------------------------

BIR_TEXT = (
    "CERTIFICATE OF REGISTRATION\nTIN 123-456-789-00000\n"
    "Registered Name: JUAN DELA CRUZ\nTax Types: Income Tax, Percentage Tax"
)


def test_bir_2303_matches_the_form(db, applicant):  # noqa: F811
    application = _app(db, applicant, "sole_proprietor")
    _texts(bir=BIR_TEXT)
    items = _items(db, application, {"gov_id": GOV, "rsbsa": RSBSA, "bir_cert": BIR})
    assert items["bir_tin"]["result"] == "pass"
    assert items["bir_name"]["result"] == "pass"
    assert items["bir_vat"]["result"] == "pass"  # non_vat entered
    # Stored encrypted / as a blind index, never as plaintext columns.
    assert application.ocr_bir_tin == "123-456-789-00000"
    assert application.ocr_bir_tin_hmac and "123" not in application.ocr_bir_tin_hmac
    raw = db.execute(
        sa.text("SELECT ocr_bir_tin FROM merchant_applications WHERE id = :id"),
        {"id": application.id},
    ).scalar()
    assert "123-456" not in raw


def test_bir_2303_mismatch(db, applicant):  # noqa: F811
    application = _app(db, applicant, "sole_proprietor")
    _texts(bir="TIN 999-888-777-000\nPEDRO SANTOS\nTax Types: Value Added Tax")
    items = _items(db, application, {"gov_id": GOV, "rsbsa": RSBSA, "bir_cert": BIR})
    assert items["bir_tin"]["result"] == "fail"
    assert items["bir_name"]["result"] == "warn"
    assert items["bir_vat"]["result"] == "fail"


def test_unreadable_2303_is_not_checked(db, applicant):  # noqa: F811
    application = _app(db, applicant, "corporation")
    _texts()
    items = _items(db, application, {"gov_id": GOV, "rsbsa": RSBSA, "bir_cert": BIR})
    assert {items[i]["result"] for i in ("bir_tin", "bir_name", "bir_vat")} == {
        "not_checked"
    }
    assert items["document_bir_cert"]["result"] == "warn"


# --- 4. duplicates ------------------------------------------------------------


def test_duplicate_files_and_numbers_link_the_other_application(db, applicant):  # noqa: F811
    # An earlier application from another account (the same person reapplying).
    other_user = make_user(db, "other@example.com")
    db.flush()
    _texts(gov="N01-12-345678")
    first = MerchantApplication(
        user_id=other_user.id,
        status="rejected",
        seller_type="sole_proprietor",
        registration_number="1234 567",
        contact_email="other@example.com",
        contact_number="+639180000000",
        region="Region III",
        province="Bulacan",
        city="Malolos",
        address="x",
        postal_code="3000",
        available_days=["Mon"],
        gov_id_number_hmac=blind_index("N01-12-345678"),
        bir_file_sha256=hashlib.sha256(BIR).hexdigest(),
    )
    db.add(first)
    db.commit()

    second = _app(
        db,
        applicant,
        "sole_proprietor",
        registration_number="1234567",
        tin="111-222-333-000",
    )
    items = _items(db, second, {"gov_id": GOV, "rsbsa": RSBSA, "bir_cert": BIR})
    duplicates = items["duplicates"]
    assert duplicates["result"] == "warn"
    assert duplicates["related_application_ids"] == [first.id]
    for what in ("registration number", "government ID number", "identical file"):
        assert what in duplicates["reason"]


def test_no_duplicates_pass(db, applicant):  # noqa: F811
    application = _app(db, applicant)
    _texts()
    assert _items(db, application, {"gov_id": GOV})["duplicates"]["result"] == "pass"


# --- 5. small producer --------------------------------------------------------


def test_small_producer_who_is_vat_registered(db, applicant):  # noqa: F811
    application = _app(
        db,
        applicant,
        "sole_proprietor",
        small_agri_producer=True,
        vat_status="vat_registered",
    )
    _texts()
    items = _items(db, application, {"gov_id": GOV, "rsbsa": RSBSA, "bir_cert": BIR})
    assert items["small_producer_vat"]["result"] == "warn"
    assert "Voluntary VAT" in items["small_producer_vat"]["reason"]


# --- 6. documents present and readable ----------------------------------------


def test_documents_missing_or_unreadable(db, applicant):  # noqa: F811
    application = _app(db, applicant)
    application.rsbsa_document_path = None
    db.commit()
    _texts(gov="DELA CRUZ JUAN")
    items = _items(db, application, {"gov_id": GOV})
    assert items["document_rsbsa"]["result"] == "fail"
    assert items["document_gov_id"]["result"] == "pass"
    _texts()
    items = _items(db, application, {"gov_id": GOV})
    assert items["document_gov_id"]["result"] == "warn"


def test_real_pdf_without_text_is_unreadable(db, applicant):  # noqa: F811
    # The default extractor: the test PDFs are blank pages (no text layer).
    application = _app(db, applicant)
    assert application.check_status == "completed"
    items = {i["id"]: i for i in application.check_checklist}
    assert items["document_gov_id"]["result"] == "warn"
    assert items["name_matches_id"]["result"] == "not_checked"


# --- the admin's confirmations ------------------------------------------------


def _decide(db, application, status, confirmed=None):
    body: dict = {"status": status}
    # Reject and clarification need a note; clarification flags a section.
    if status in ("rejected", "clarification"):
        body["admin_note"] = "Please correct the application."
    if status == "clarification":
        body["sections"] = ["documents"]
    if confirmed is not None:
        body["confirmed_items"] = confirmed
    return _admin_client(db, _staff(db)).patch(
        f"/admin/merchant-applications/{application.id}", json=body
    )


def test_accept_needs_every_warn_and_fail_confirmed(db, applicant):  # noqa: F811
    application = _app(db, applicant)
    needing = [
        i["id"] for i in application.check_checklist if i["result"] in ("warn", "fail")
    ]
    assert needing

    res = _decide(db, application, "approved")
    assert res.status_code == 409
    assert "Review these checklist items" in res.json()["detail"]
    res = _decide(db, application, "approved", needing[:-1])
    assert res.status_code == 409

    res = _decide(db, application, "approved", needing)
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(needing) <= set(body["check_confirmations"])
    assert body["check_checklist"]


@pytest.mark.parametrize("status", ["rejected", "clarification"])
def test_reject_and_clarify_never_need_the_checklist(db, applicant, status):  # noqa: F811
    application = _app(db, applicant)
    assert _decide(db, application, status).status_code == 200


def test_failed_checks_do_not_block_a_manual_review(db, applicant):  # noqa: F811
    class Broken:
        def extract_text(self, data: bytes) -> str | None:
            raise RuntimeError("boom")

    document_checks.set_extractor(Broken())
    application = _app(db, applicant)
    assert application.check_status == "failed"
    assert application.check_checklist is None
    assert _decide(db, application, "approved").status_code == 200


def test_admin_can_rerun_the_checks(db, applicant, monkeypatch):  # noqa: F811
    application = _app(db, applicant)
    application.check_status = "failed"
    db.commit()
    monkeypatch.setattr(r2_service, "get_private_document", lambda path: GOV)
    _texts(gov="DELA CRUZ JUAN")
    res = _admin_client(db, _staff(db)).post(
        f"/admin/merchant-applications/{application.id}/checks/rerun"
    )
    assert res.status_code == 200, res.text
    items = {i["id"]: i for i in res.json()["check_checklist"]}
    assert res.json()["check_status"] == "completed"
    assert items["name_matches_id"]["result"] == "pass"


def test_resubmitting_runs_the_checks_again(db, applicant):  # noqa: F811
    application = _app(db, applicant)
    first = application.checked_at
    assert _decide(db, application, "clarification").status_code == 200

    class Reads:
        def extract_text(self, data: bytes) -> str | None:
            return "DELA CRUZ JUAN"

    document_checks.set_extractor(Reads())
    assert _submit(db, applicant).status_code == 200
    db.refresh(application)
    assert application.checked_at >= first
    assert application.check_confirmations is None
    items = {i["id"]: i for i in application.check_checklist}
    assert items["name_matches_id"]["result"] == "pass"


# --- Google Cloud Vision OCR --------------------------------------------------


class _VisionResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self):
        return self.payload


def test_vision_reads_photos_and_scanned_pdfs(monkeypatch):
    calls = []

    def post(url, json, headers, timeout):
        calls.append((url, headers["X-Goog-Api-Key"]))
        page = {"fullTextAnnotation": {"text": "DELA CRUZ JUAN"}}
        if url.endswith("files:annotate"):
            return _VisionResponse({"responses": [{"responses": [page]}]})
        return _VisionResponse({"responses": [page]})

    monkeypatch.setattr(document_checks.requests, "post", post)
    monkeypatch.setenv("GOOGLE_CLOUD_VISION", "key")
    document_checks.set_extractor(None)
    extractor = document_checks.get_extractor()
    assert extractor.extract_text(b"\xff\xd8jpeg") == "DELA CRUZ JUAN"
    # A PDF with no text layer: pypdf gives nothing, so Vision reads it.
    monkeypatch.setattr(
        document_checks.PypdfExtractor, "extract_text", lambda self, data: None
    )
    assert extractor.extract_text(b"%PDF-scan") == "DELA CRUZ JUAN"
    assert [url.rsplit("/", 1)[1] for url, _ in calls] == [
        "images:annotate",
        "files:annotate",
    ]
    assert all(key == "key" for _, key in calls)


def test_vision_failure_is_not_checked(monkeypatch):
    def post(*args, **kwargs):
        raise document_checks.requests.ConnectionError("down")

    monkeypatch.setattr(document_checks.requests, "post", post)
    assert document_checks.GoogleVisionExtractor("key").extract_text(b"img") is None

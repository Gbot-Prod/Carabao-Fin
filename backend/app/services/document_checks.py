"""Automated checks on a merchant application's documents (the review checklist).

They only assist: every result is a prompt for the admin, who makes every
decision. The system does NOT verify numbers with DTI, SEC, CDA or the BIR; it
only reads the uploaded documents.

What is stored (merchant_applications):
* SHA-256 of each file (duplicate files across applications);
* the name and numbers read from the documents: names encrypted, numbers as
  blind indexes (HMAC), the BIR TIN encrypted plus a blind index. The full
  extracted text is never stored;
* ``check_checklist``: one item per check, {id, label, result, reason,
  document, related_application_ids}, so the review page does not recompute it;
* ``check_status``: pending | completed | failed.

Text extraction is pluggable (``Extractor``). The default reads PDFs that have
a text layer (pypdf). Photos and scans give no text, and the checks that need
text say "not checked" / ask the admin to look. A real OCR provider can be set
with ``set_extractor`` without changing the schema.
"""

from __future__ import annotations

import hashlib
import io
import logging
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from difflib import SequenceMatcher
from typing import Any, Literal, Protocol

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.field_crypto import blind_index
from app.models.merchant_application import MerchantApplication
from app.schemas.merchant_application import (
    INDIVIDUAL_SELLERS,
    REGISTERED_SELLERS,
    full_name,
    normalize_tin,
)

logger = logging.getLogger(__name__)

Result = Literal["pass", "warn", "fail", "not_checked"]
NEEDS_CONFIRMATION: frozenset[str] = frozenset({"warn", "fail"})

PENDING, COMPLETED, FAILED = "pending", "completed", "failed"

# --- thresholds and formats (easy to change) ----------------------------------

# Name on the government ID vs the entered legal name (0..1).
NAME_PASS_SCORE = 0.85
NAME_WARN_SCORE = 0.60

# Registration number formats per agency, checked on the number with spaces
# removed and upper-cased. No agency publishes a specification, so these
# follow the numbers seen on real certificates and a mismatch is only a warn:
# * DTI Business Name (BNRS): 7-8 digits, sometimes written with "BN".
# * SEC: a letter prefix (CS, AS, PG, PL, FS, FN, OS, CN, A...) with the
#   year and a sequence ("CS201912345", "CS2023-00001", "A199812345"), or the
#   longer all-digit eSPARC numbers.
# * CDA: "9520-" followed by 6-20 digits ("9520-15005879",
#   "9520-1015000000027142").
REGISTRATION_FORMATS: dict[str, tuple[re.Pattern[str], str]] = {
    "DTI": (re.compile(r"^(BN-?)?\d{7,8}$"), "7 or 8 digits, e.g. 1234567"),
    "SEC": (
        re.compile(
            r"^([A-Z]{1,3}-?\d{4}-?\d{3,7}|[A-Z]{1,3}\d{5,12}|\d{9,16}(-\d{2})?)$"
        ),
        "a letter prefix and digits, e.g. CS201912345",
    ),
    "CDA": (re.compile(r"^9520-?\d{6,20}$"), "9520- and digits, e.g. 9520-15005879"),
}

_TIN_IN_TEXT = re.compile(
    r"(?<!\d)(\d{3})[\s-]?(\d{3})[\s-]?(\d{3})[\s-]?(\d{3,5})(?!\d)"
)
_RSBSA_IN_TEXT = re.compile(r"(?<!\d)\d{2}-\d{2}-\d{2}-\d{3}-\d{5,6}(?!\d)")
# An ID card number: groups of letters/digits with at least 8 digits in all.
_ID_NUMBER_IN_TEXT = re.compile(
    r"\b[A-Z0-9]{1,5}(?:[- ][A-Z0-9]{2,8}){1,4}\b|\b\d{8,16}\b"
)
_VAT_IN_TEXT = re.compile(r"value[\s-]*added\s+tax|\bVAT\b", re.IGNORECASE)
_PERCENTAGE_TAX_IN_TEXT = re.compile(r"percentage\s+tax", re.IGNORECASE)

DOCUMENT_LABELS = {
    "rsbsa": "RSBSA document",
    "gov_id": "Government ID",
    "bir_cert": "BIR Form 2303",
}


# --- text extraction ----------------------------------------------------------


class Extractor(Protocol):
    def extract_text(self, data: bytes) -> str | None:
        """The document's text, or None when none could be read."""


class PypdfExtractor:
    """Text from PDFs that have a text layer. Images and scanned PDFs: None."""

    def extract_text(self, data: bytes) -> str | None:
        if not data.startswith(b"%PDF-"):
            return None
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:5])
        return text if text.strip() else None


_extractor: Extractor = PypdfExtractor()


def set_extractor(extractor: Extractor) -> None:
    global _extractor
    _extractor = extractor


def get_extractor() -> Extractor:
    return _extractor


# --- helpers ------------------------------------------------------------------


def _fold(text: str) -> str:
    """Upper-case ASCII words only: 'Dela Cruz, Juan Ñ.' -> 'DELA CRUZ JUAN N'."""
    ascii_text = (
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    )
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", ascii_text.upper()).split())


def name_score(expected: str, text: str) -> tuple[float, str | None]:
    """How well ``expected`` appears in ``text`` (0..1), and the best line.

    The share of the name's words found in the text (IDs print names in any
    order, e.g. "DELA CRUZ, JUAN"), or the best line's similarity if higher.
    """
    want = _fold(expected).split()
    if not want:
        return 0.0, None
    lines = [_fold(line) for line in text.splitlines() if line.strip()]
    words = set(" ".join(lines).split())
    coverage = sum(1 for word in want if word in words) / len(want)
    best_line, best_ratio = None, 0.0
    target = " ".join(sorted(want))
    for line in lines:
        ratio = SequenceMatcher(None, target, " ".join(sorted(line.split()))).ratio()
        if ratio > best_ratio:
            best_line, best_ratio = line, ratio
    # The line with the most of the name's words, kept (encrypted) for the admin.
    if lines:
        best_line = max(lines, key=lambda line: sum(w in line.split() for w in want))
    return round(max(coverage, best_ratio), 3), best_line


def _score_result(score: float) -> Result:
    if score >= NAME_PASS_SCORE:
        return "pass"
    if score >= NAME_WARN_SCORE:
        return "warn"
    return "fail"


def find_tin(text: str) -> str | None:
    match = _TIN_IN_TEXT.search(text)
    if not match:
        return None
    try:
        return normalize_tin("".join(match.groups()))
    except ValueError:
        return None


def _tin_root(tin: str | None) -> str | None:
    """The 9-digit TIN without the branch code."""
    digits = re.sub(r"\D", "", tin or "")
    return digits[:9] if len(digits) >= 9 else None


def find_vat_status(text: str) -> str | None:
    """VAT vs non-VAT from the tax types a 2303 lists."""
    if _VAT_IN_TEXT.search(text):
        return "vat_registered"
    if _PERCENTAGE_TAX_IN_TEXT.search(text):
        return "non_vat"
    return None


def find_id_number(text: str) -> str | None:
    for match in _ID_NUMBER_IN_TEXT.finditer(text.upper()):
        token = match.group(0)
        if sum(ch.isdigit() for ch in token) >= 8:
            return token
    return None


def normalize_registration(number: str) -> str:
    return re.sub(r"\s+", "", number).upper()


def registration_format_ok(registration_type: str, number: str) -> bool | None:
    entry = REGISTRATION_FORMATS.get(registration_type)
    if entry is None:
        return None
    return bool(entry[0].match(normalize_registration(number)))


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class Item:
    id: str
    label: str
    result: Result
    reason: str
    document: str | None = None
    related_application_ids: list[int] = field(default_factory=list)


def required_documents(seller_type: str | None) -> list[str]:
    docs = ["rsbsa", "gov_id"]
    if seller_type in REGISTERED_SELLERS:
        docs.append("bir_cert")
    return docs


def _expected_id_name(application: Any) -> tuple[str | None, str]:
    """The name the government ID should show, and whose it is."""
    if application.seller_type in INDIVIDUAL_SELLERS:
        name = full_name(
            application.first_name,
            application.middle_name,
            application.last_name,
            application.suffix,
        )
        return name, "the legal name"
    name = full_name(
        application.rep_first_name,
        application.rep_middle_name,
        application.rep_last_name,
        application.rep_suffix,
    )
    return name, "the authorized representative"


# --- the checks ---------------------------------------------------------------


def _check_documents(application: Any, texts: dict[str, str | None]) -> list[Item]:
    items = []
    for doc in required_documents(application.seller_type):
        label = DOCUMENT_LABELS[doc]
        item_id = f"document_{doc}"
        if not getattr(application, f"{doc}_document_path"):
            items.append(Item(item_id, f"{label} uploaded", "fail", "Missing.", doc))
        elif texts.get(doc) is None:
            items.append(
                Item(
                    item_id,
                    f"{label} readable",
                    "warn",
                    "No text could be read (a photo or a scan). Check it by eye.",
                    doc,
                )
            )
        else:
            items.append(
                Item(item_id, f"{label} readable", "pass", "Text was read.", doc)
            )
    return items


def _check_name(
    application: Any, text: str | None
) -> tuple[Item, float | None, str | None]:
    label = "Name matches the government ID"
    expected, whose = _expected_id_name(application)
    if expected is None:
        reason = (
            "No authorized representative is collected for this seller type."
            if application.seller_type == "cooperative"
            else "No name was entered."
        )
        return (
            Item("name_matches_id", label, "not_checked", reason, "gov_id"),
            None,
            None,
        )
    if text is None:
        return (
            Item(
                "name_matches_id",
                label,
                "not_checked",
                "No text could be read from the ID. Compare the name by eye.",
                "gov_id",
            ),
            None,
            None,
        )
    score, line = name_score(expected, text)
    result = _score_result(score)
    reason = {
        "pass": f"The ID shows {whose} ({score:.0%} match).",
        "warn": f"Only a partial match with {whose} ({score:.0%}). Compare by eye.",
        "fail": f"The ID does not seem to show {whose} ({score:.0%} match).",
    }[result]
    return Item("name_matches_id", label, result, reason, "gov_id"), score, line


def _check_registration(application: Any) -> Item | None:
    registration_type = application.registration_type
    if not registration_type or registration_type not in REGISTRATION_FORMATS:
        return None
    label = f"{registration_type} registration number format"
    number = application.registration_number
    if not number:
        return Item("registration_format", label, "fail", "No number was entered.")
    if registration_format_ok(registration_type, number):
        return Item("registration_format", label, "pass", "The format looks right.")
    hint = REGISTRATION_FORMATS[registration_type][1]
    return Item(
        "registration_format",
        label,
        "warn",
        f"Not the usual {registration_type} format ({hint}). Check the certificate.",
    )


def _check_bir(
    application: Any, text: str | None
) -> tuple[list[Item], dict[str, str | None]]:
    """TIN, registered name and VAT status read from the 2303 vs the form."""
    found: dict[str, str | None] = {"tin": None, "name": None, "vat": None}
    if application.seller_type not in REGISTERED_SELLERS:
        return [], found
    labels = {
        "bir_tin": "TIN matches the BIR 2303",
        "bir_name": "Registered name matches the BIR 2303",
        "bir_vat": "VAT status matches the BIR 2303",
    }
    if text is None:
        reason = "No text could be read from the 2303. Compare it by eye."
        return [
            Item(item_id, label, "not_checked", reason, "bir_cert")
            for item_id, label in labels.items()
        ], found

    items = []
    tin = find_tin(text)
    found["tin"] = tin
    if tin is None:
        items.append(
            Item(
                "bir_tin",
                labels["bir_tin"],
                "warn",
                "No TIN found on the 2303.",
                "bir_cert",
            )
        )
    elif _tin_root(tin) == _tin_root(application.tin):
        items.append(
            Item("bir_tin", labels["bir_tin"], "pass", "Same TIN.", "bir_cert")
        )
    else:
        items.append(
            Item(
                "bir_tin",
                labels["bir_tin"],
                "fail",
                "The TIN on the 2303 is not the one entered.",
                "bir_cert",
            )
        )

    expected = application.legal_business_name or ""
    score, line = name_score(expected, text) if expected else (0.0, None)
    found["name"] = line
    name_result = _score_result(score) if expected else "not_checked"
    # A name difference is a prompt to look (trade names, abbreviations).
    if name_result == "fail":
        name_result = "warn"
    items.append(
        Item(
            "bir_name",
            labels["bir_name"],
            name_result,
            f"{score:.0%} match with the registered name entered."
            if expected
            else "No registered name was entered.",
            "bir_cert",
        )
    )

    vat = find_vat_status(text)
    found["vat"] = vat
    if vat is None:
        items.append(
            Item(
                "bir_vat",
                labels["bir_vat"],
                "warn",
                "No tax types could be read. Check VAT vs non-VAT by eye.",
                "bir_cert",
            )
        )
    elif vat == application.vat_status:
        items.append(
            Item("bir_vat", labels["bir_vat"], "pass", "Same VAT status.", "bir_cert")
        )
    else:
        shown = "VAT" if vat == "vat_registered" else "non-VAT (percentage tax)"
        items.append(
            Item(
                "bir_vat",
                labels["bir_vat"],
                "fail",
                f"The 2303 lists {shown}, which is not what was entered.",
                "bir_cert",
            )
        )
    return items, found


def _check_small_producer(application: Any) -> Item | None:
    if application.small_agri_producer is not True:
        return None
    label = "Small agricultural producer declaration"
    if application.vat_status == "vat_registered":
        return Item(
            "small_producer_vat",
            label,
            "warn",
            "Declared a small producer but VAT-registered. Voluntary VAT "
            "registration is legal; this is only a prompt to look.",
        )
    return Item("small_producer_vat", label, "pass", "Consistent with the tax status.")


def _check_duplicates(db: Session, application: Any) -> Item:
    """The same number or file on another application (the same person
    reapplying, or a document used twice)."""
    others = db.query(MerchantApplication.id).filter(
        MerchantApplication.id != application.id
    )
    matches: dict[str, set[int]] = {}

    def add(what: str, rows: Iterable[tuple[int]]) -> None:
        ids = {row[0] for row in rows}
        if ids:
            matches.setdefault(what, set()).update(ids)

    tin_digests = {d for d in (application.tin_hmac, application.ocr_bir_tin_hmac) if d}
    if tin_digests:
        add(
            "TIN",
            others.filter(
                or_(
                    MerchantApplication.tin_hmac.in_(tin_digests),
                    MerchantApplication.ocr_bir_tin_hmac.in_(tin_digests),
                )
            ).all(),
        )
    rsbsa_digests = {
        d
        for d in (application.rsbsa_number_hmac, application.ocr_rsbsa_number_hmac)
        if d
    }
    if rsbsa_digests:
        add(
            "RSBSA number",
            others.filter(
                or_(
                    MerchantApplication.rsbsa_number_hmac.in_(rsbsa_digests),
                    MerchantApplication.ocr_rsbsa_number_hmac.in_(rsbsa_digests),
                )
            ).all(),
        )
    if application.registration_number:
        number = normalize_registration(application.registration_number)
        add(
            "registration number",
            others.filter(
                func.upper(
                    func.replace(MerchantApplication.registration_number, " ", "")
                )
                == number
            ).all(),
        )
    if application.gov_id_number_hmac:
        add(
            "government ID number",
            others.filter(
                MerchantApplication.gov_id_number_hmac == application.gov_id_number_hmac
            ).all(),
        )
    hashes = {
        h
        for h in (
            application.rsbsa_file_sha256,
            application.gov_id_file_sha256,
            application.bir_file_sha256,
        )
        if h
    }
    if hashes:
        add(
            "identical file",
            others.filter(
                or_(
                    MerchantApplication.rsbsa_file_sha256.in_(hashes),
                    MerchantApplication.gov_id_file_sha256.in_(hashes),
                    MerchantApplication.bir_file_sha256.in_(hashes),
                )
            ).all(),
        )

    label = "No duplicates in other applications"
    if not matches:
        return Item("duplicates", label, "pass", "No other application shares these.")
    related = sorted(set().union(*matches.values()))
    parts = ", ".join(
        f"{what} (#{', #'.join(str(i) for i in sorted(ids))})"
        for what, ids in matches.items()
    )
    return Item(
        "duplicates",
        label,
        "warn",
        f"Shared with another application: {parts}. It may be the same person "
        "reapplying.",
        related_application_ids=related,
    )


# --- running ------------------------------------------------------------------


def run_checks(
    db: Session, application: Any, documents: dict[str, bytes]
) -> list[dict[str, Any]]:
    """Fill the check columns and the checklist from ``documents``
    ({"rsbsa"|"gov_id"|"bir_cert": file bytes}). The caller commits."""
    extractor = get_extractor()
    texts: dict[str, str | None] = {}
    for doc, data in documents.items():
        texts[doc] = extractor.extract_text(data)

    if "rsbsa" in documents:
        application.rsbsa_file_sha256 = _sha256(documents["rsbsa"])
    if "gov_id" in documents:
        application.gov_id_file_sha256 = _sha256(documents["gov_id"])
    application.bir_file_sha256 = (
        _sha256(documents["bir_cert"]) if "bir_cert" in documents else None
    )

    gov_text = texts.get("gov_id")
    id_number = find_id_number(gov_text) if gov_text else None
    application.gov_id_number_hmac = blind_index(id_number)
    rsbsa_text = texts.get("rsbsa")
    rsbsa_match = _RSBSA_IN_TEXT.search(rsbsa_text) if rsbsa_text else None
    ocr_rsbsa = rsbsa_match.group(0) if rsbsa_match else None
    application.ocr_rsbsa_number = ocr_rsbsa
    application.ocr_rsbsa_number_hmac = blind_index(ocr_rsbsa)

    items: list[Item] = _check_documents(application, texts)
    name_item, score, line = _check_name(application, gov_text)
    application.name_match_score = score
    application.ocr_gov_id_name = line
    items.insert(0, name_item)

    registration = _check_registration(application)
    if registration:
        items.append(registration)

    bir_items, found = _check_bir(application, texts.get("bir_cert"))
    application.ocr_bir_tin = found["tin"]
    application.ocr_bir_name = found["name"]
    application.ocr_bir_vat_status = found["vat"]
    items.extend(bir_items)

    small = _check_small_producer(application)
    if small:
        items.append(small)

    db.flush()
    items.append(_check_duplicates(db, application))

    checklist = [asdict(item) for item in items]
    application.check_checklist = checklist
    application.check_flags = [
        item["id"] for item in checklist if item["result"] in NEEDS_CONFIRMATION
    ]
    return checklist


def run_and_save(db: Session, application: Any, documents: dict[str, bytes]) -> None:
    """Run the checks and commit. Never raises: a failure is saved as
    check_status "failed" (the admin can re-run, or review by hand)."""
    app_id = application.id
    try:
        application.check_status = PENDING
        # A new run is a new review: earlier confirmations no longer apply.
        application.check_confirmations = None
        run_checks(db, application, documents)
        application.check_status = COMPLETED
        application.checked_at = datetime.now(UTC)
        db.commit()
    except Exception:
        logger.exception("Document checks failed for application %s", app_id)
        db.rollback()
        fresh = db.get(MerchantApplication, app_id)
        if fresh is not None:
            fresh.check_status = FAILED
            fresh.check_checklist = None
            fresh.check_confirmations = None
            fresh.checked_at = datetime.now(UTC)
            db.commit()


def load_documents(application: Any) -> dict[str, bytes]:
    """The application's uploaded files from the private bucket (for a re-run).

    A download error is left to propagate; run_and_save is not reached then,
    so the caller sees a 502 instead of a silently empty checklist.
    """
    from app.core.errors import upstream_error
    from app.services import r2_service

    documents: dict[str, bytes] = {}
    for doc in DOCUMENT_LABELS:
        path = getattr(application, f"{doc}_document_path")
        if not path:
            continue
        try:
            documents[doc] = r2_service.get_private_document(path)
        except Exception as exc:
            raise upstream_error(
                502,
                "Could not read the documents to check them",
                log=f"R2 {DOCUMENT_LABELS[doc]} download failed",
                exc=exc,
            ) from exc
    return documents


# --- the admin's confirmations ------------------------------------------------


def items_needing_confirmation(application: Any) -> list[dict[str, Any]]:
    if application.check_status != COMPLETED or not application.check_checklist:
        # Still running, or failed: never block a manual review.
        return []
    return [
        item
        for item in application.check_checklist
        if item.get("result") in NEEDS_CONFIRMATION
    ]


def confirm_items(application: Any, confirmed: list[str], admin_id: int | None) -> None:
    """Store the admin's ticks; refuse (409) while a warn or fail item is unticked.

    Only Accept calls this. Pass items count as confirmed.
    """
    ticked = set(confirmed)
    missing = [
        item
        for item in items_needing_confirmation(application)
        if item["id"] not in ticked
    ]
    if missing:
        labels = "; ".join(item["label"] for item in missing)
        raise HTTPException(
            status_code=409,
            detail=f"Review these checklist items before accepting: {labels}.",
        )
    known = {item["id"]: item for item in application.check_checklist or []}
    now = datetime.now(UTC).isoformat()
    application.check_confirmations = {
        item_id: {"by": admin_id, "at": now, "result": item["result"]}
        for item_id, item in known.items()
        if item_id in ticked or item["result"] == "pass"
    }

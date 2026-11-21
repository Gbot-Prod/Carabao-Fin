from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db, require_verified_phone
from app.api.routes.email_otp import MERCHANT_EMAIL_PURPOSE
from app.core.errors import FieldErrors, upstream_error
from app.core.field_crypto import blind_index
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.user import User, normalize_email
from app.schemas.merchant_application import (
    BUSINESS_DETAILS_MODELS,
    INDIVIDUAL_SELLERS,
    REGISTERED_SELLERS,
    REGISTRATION_FOR_SELLER,
    MerchantApplicationResponse,
    MerchantOnboardingPayload,
    full_name,
)
from app.services import r2_service, rate_limit, upload_validation
from app.services.application_review import (
    PENDING_DOCUMENTS,
    SUBMITTED,
    check_can_resubmit,
)
from app.services.merchant_service import get_active_merchant
from app.services.phone_verification import normalize_ph_mobile, read_token
from app.services.pinned_location import PinCheck, apply_pin, validate_pin
from app.services.rate_limit import lock_keys
from app.services.service_area import OUTSIDE_LUZON_DETAIL, is_luzon_region
from app.services.upload_validation import CheckedFile

router = APIRouter(tags=["merchant-onboarding"])
logger = logging.getLogger(__name__)


def _reject_duplicate_identifiers(
    db: Session, user_id: int, tin: str | None, rsbsa_number: str | None
) -> None:
    """A TIN or RSBSA number can belong to only one account (CF-0007).

    The values are encrypted with a random nonce, so the lookup uses the
    keyed hash (blind index) columns.

    Two requests with the same TIN could both pass the check before either
    commits (CF-0028). An advisory lock on each hash makes them wait for each
    other until the transaction ends; the partial unique indexes are the last
    guard.
    """
    checks = (
        ("TIN", blind_index(tin), "tin"),
        ("RSBSA number", blind_index(rsbsa_number), "rsbsa_number"),
    )
    lock_keys(
        db,
        *(
            f"merchant-identifier:{field}_hmac:{digest}"
            for _, digest, field in checks
            if digest
        ),
    )
    for label, digest, field in checks:
        if digest is None:
            continue
        column = f"{field}_hmac"
        used_by_application = (
            db.query(MerchantApplication.id)
            .filter(
                getattr(MerchantApplication, column) == digest,
                MerchantApplication.user_id != user_id,
            )
            .first()
        )
        used_by_merchant = (
            db.query(Merchant.id)
            .filter(
                getattr(Merchant, column) == digest,
                Merchant.user_id != user_id,
                Merchant.deleted_at.is_(None),
            )
            .first()
        )
        if used_by_application or used_by_merchant:
            raise FieldErrors(
                {field: f"This {label} is already used by another account."},
                status_code=409,
            )


_FIELD_LABELS = {
    "region": "Region",
    "province": "Province",
    "city": "City / municipality",
    "barangay": "Barangay",
    "address": "Address",
    "postal_code": "Postal code",
    "pin": "Map pin",
    "available_days": "Available days",
    "contact_email": "Contact email",
    "contact_number": "Contact number",
    "email_verification_token": "Email verification",
    "phone_verification_token": "Phone verification",
    "submit_mode": "Submit business information",
    "seller_type": "Seller type",
    "merchant_name": "Merchant name",
    "last_name": "Last name",
    "first_name": "First name",
    "middle_name": "Middle name",
    "suffix": "Suffix",
    "rep_last_name": "Representative's last name",
    "rep_first_name": "Representative's first name",
    "rep_middle_name": "Representative's middle name",
    "rep_suffix": "Representative's suffix",
    "company_name": "Company registered name",
    "trade_name": "Business / trade name",
    "tin": "TIN",
    "vat_status": "VAT registration status",
    "registration_number": "Registration number",
    "small_agri_producer": "Small agricultural producer declaration",
    "rsbsa_number": "RSBSA number",
    "gov_id_type": "Government ID type",
    "terms_accepted": "Terms and Data Privacy agreement",
    "terms_version": "Terms version",
    "rsbsa_file": "RSBSA document",
    "gov_id_file": "Government ID",
    "bir_cert_file": "BIR Certificate of Registration",
}


def _error_field(error: dict) -> str:
    """The form field a Pydantic error belongs to (lat/lng are one pin)."""
    loc = error.get("loc") or ()
    field = str(loc[0]) if loc else ""
    return "pin" if field in ("lat", "lng") else field


def _describe_error(error: dict) -> str:
    """One Pydantic error as a sentence an applicant can act on."""
    field = _error_field(error)
    label = _FIELD_LABELS.get(field, field.replace("_", " ").capitalize() or "A field")
    kind = error.get("type", "")
    ctx = error.get("ctx") or {}
    if field == "terms_accepted" and kind in ("missing", "literal_error"):
        return "Accept the Terms of Service and Data Privacy Policy to submit"
    if kind == "missing":
        return f"{label} is required"
    if kind == "extra_forbidden" and field in _FIELD_LABELS:
        # A known field that the chosen seller type does not use.
        return f"{label} does not apply to this seller type"
    if kind == "string_too_short":
        if ctx.get("min_length", 1) <= 1:
            return f"{label} is required"
        return f"{label} must be at least {ctx['min_length']} characters"
    if kind == "string_too_long":
        return f"{label} must be at most {ctx.get('max_length')} characters"
    if kind == "too_short":
        return f"{label}: select at least {ctx.get('min_length', 1)}"
    if kind == "too_long":
        return f"{label}: select at most {ctx.get('max_length')}"
    if kind == "literal_error":
        return f"{label} is not one of the allowed options"
    if kind == "extra_forbidden":
        return f"Unexpected field: {field}"
    if field == "contact_email":
        return "Contact email is not a valid email address"
    if field == "available_days" and kind == "value_error":
        return "Each available day may be selected only once"
    if kind == "value_error":
        # A field_validator's own reason, without Pydantic's "Value error, " prefix.
        reason = str(error.get("msg", "")).removeprefix("Value error, ").rstrip(".")
        if reason:
            return f"{label}: {reason}"
    return f"{label} is invalid"


def _payload_field_errors(exc: ValidationError) -> dict[str, str]:
    """The first problem per field, e.g. {"postal_code": "Postal code is required."}."""
    errors: dict[str, str] = {}
    for error in exc.errors():
        field = _error_field(error) or "payload"
        errors.setdefault(field, _describe_error(error) + ".")
    return errors


def _with_field(field: str, call, *args):
    """Run a check that raises a plain 400/413/422, and tie its message to ``field``."""
    try:
        return call(*args)
    except FieldErrors:
        raise
    except HTTPException as exc:
        # 413: an upload over the size cap, shown under its dropzone.
        if exc.status_code not in (400, 413, 422):
            raise
        raise FieldErrors(
            {field: str(exc.detail)}, status_code=exc.status_code
        ) from exc


def _discard_uploads(*paths: str) -> None:
    """Remove documents uploaded for a submit that failed (no orphan files)."""
    for path in paths:
        try:
            r2_service.delete_private_document(path)
        except Exception:  # noqa: BLE001 - the original error matters more
            logger.warning("R2 cleanup failed for an onboarding document")


@router.get("/merchant-applications/me", response_model=MerchantApplicationResponse)
def get_my_merchant_application_route(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    application = (
        db.query(MerchantApplication)
        .filter(MerchantApplication.user_id == current_user.id)
        .first()
    )
    if application is None:
        raise HTTPException(status_code=404, detail="No merchant application found")
    return application


@router.post("/merchant-onboarding/me", response_model=MerchantApplicationResponse)
def submit_my_merchant_onboarding_route(
    payload: str = Form(...),
    # Needed for "Submit now" only: RSBSA and government ID always, BIR Form
    # 2303 for registered seller types. "Submit later" sends none.
    rsbsa_file: UploadFile | None = File(None),
    gov_id_file: UploadFile | None = File(None),
    bir_cert_file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_verified_phone),
):
    # CF-0077: first, before the documents are scanned, re-encoded and stored.
    rate_limit.enforce_action(db, "onboarding_submit", str(current_user.id))
    try:
        parsed = json.loads(payload)
    # RecursionError: deeply nested JSON, e.g. "[[[[...]]]]".
    except (ValueError, RecursionError) as exc:
        raise HTTPException(
            status_code=400, detail="Invalid onboarding payload"
        ) from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Invalid onboarding payload")
    data, details = _validate_payload(parsed)

    sent = {
        "rsbsa_file": rsbsa_file,
        "gov_id_file": gov_id_file,
        "bir_cert_file": bir_cert_file,
    }
    files = {field: f for field, f in sent.items() if f is not None and f.filename}
    _check_files_for_mode(data, files)

    if not is_luzon_region(data.region):
        raise FieldErrors({"region": OUTSIDE_LUZON_DETAIL})
    pin = _with_field("pin", validate_pin, data.lat, data.lng)

    # The shop's contact number is proven either by being the account's own
    # verified number or by a code sent to it (/sms/otp/verify).
    contact = normalize_ph_mobile(data.contact_number)
    account_phone = normalize_ph_mobile(current_user.phone_number or "")
    verified = read_token(data.phone_verification_token)
    is_account_phone = contact is not None and contact == account_phone
    has_token = (
        verified is not None
        and verified.get("purpose") == "merchant_phone"
        and verified.get("user_id") == current_user.id
        and verified.get("number") == contact
    )
    if not (is_account_phone or has_token):
        raise FieldErrors(
            {"contact_number": "Please verify your contact number first."}
        )

    # The same for the contact email: the account's own verified email, or a
    # code sent to it (/email/otp/verify).
    contact_email = normalize_email(str(data.contact_email))
    account_email = current_user.verified_email
    email_token = read_token(data.email_verification_token)
    email_verified = (
        account_email is not None and normalize_email(account_email) == contact_email
    ) or (
        email_token is not None
        and email_token.get("purpose") == MERCHANT_EMAIL_PURPOSE
        and email_token.get("user_id") == current_user.id
        and email_token.get("email") == contact_email
    )
    if not email_verified:
        raise FieldErrors({"contact_email": "Please verify your contact email first."})

    has_active_merchant = get_active_merchant(db, current_user.id) is not None
    if has_active_merchant:
        raise HTTPException(
            status_code=409, detail="User already has a merchant profile"
        )
    application = (
        db.query(MerchantApplication)
        .filter(MerchantApplication.user_id == current_user.id)
        .with_for_update()
        .first()
    )
    # Only a new, rejected, clarification or pending_documents application
    # goes (back) to submitted (CF-0010); checked before any upload.
    check_can_resubmit(application, has_active_merchant)

    if details is None:
        # Submit later: step 1 and the seller type only. Business information
        # already on the row (e.g. from a rejected application) stays for the
        # pre-fill.
        if application is None:
            application = MerchantApplication(user_id=current_user.id)
            db.add(application)
        _apply_operations(application, data, contact_email, f"+{contact}", pin)
        application.seller_type = data.seller_type
        application.status = PENDING_DOCUMENTS
        application.submitted_at = None
        return _commit(db, application, uploaded=[], replaced=[])

    tin = details.get("tin")
    rsbsa_number = details.get("rsbsa_number")
    _reject_duplicate_identifiers(
        db,
        current_user.id,
        tin if isinstance(tin, str) else None,
        rsbsa_number if isinstance(rsbsa_number, str) else None,
    )

    # Every file is checked before any is uploaded.
    checked = {
        field: _with_field(
            field,
            upload_validation.check_document_upload,
            upload,
            _FILE_LABELS[field],
        )
        for field, upload in files.items()
    }
    uploaded: dict[str, str] = {}
    for field, check in checked.items():
        try:
            uploaded[field] = _upload(field, current_user.id, check)
        except Exception as exc:
            _discard_uploads(*uploaded.values())
            raise upstream_error(
                502,
                "Document upload failed",
                log=f"R2 {_FILE_LABELS[field]} upload failed",
                exc=exc,
            ) from exc

    # CF-0040: the files this resubmit replaces (or that the new seller type
    # no longer uses), deleted once it is saved.
    if application is None:
        # Created only now, so a failed check or upload above leaves no row.
        application = MerchantApplication(user_id=current_user.id)
        db.add(application)
    replaced = [
        application.rsbsa_document_path,
        application.gov_id_document_path,
        application.bir_cert_document_path,
    ]

    _apply_operations(application, data, contact_email, f"+{contact}", pin)
    application.seller_type = data.seller_type
    _apply_business_details(application, data.seller_type, details)
    for prefix in _DOCUMENT_COLUMNS.values():
        # A document the seller type does not use (BIR 2303 for a farmer).
        setattr(application, f"{prefix}_path", None)
        setattr(application, f"{prefix}_original_name", None)
        setattr(application, f"{prefix}_content_type", None)
    for field, path in uploaded.items():
        prefix = _DOCUMENT_COLUMNS[field]
        setattr(application, f"{prefix}_path", path)
        setattr(
            application,
            f"{prefix}_original_name",
            upload_validation.safe_filename(files[field].filename),
        )
        # The type the server found, not the type the client declared.
        setattr(application, f"{prefix}_content_type", checked[field].content_type)

    now = datetime.now(UTC)
    application.terms_accepted_at = now
    application.status = SUBMITTED
    application.submitted_at = now
    return _commit(
        db, application, uploaded=list(uploaded.values()), replaced=replaced
    )


# Section 2 columns set from the business details. A column the seller type
# does not use is cleared, so a resubmit as another type leaves nothing stale.
_BUSINESS_COLUMNS = (
    "merchant_name",
    "last_name",
    "first_name",
    "middle_name",
    "suffix",
    "rep_last_name",
    "rep_first_name",
    "rep_middle_name",
    "rep_suffix",
    "company_name",
    "trade_name",
    "registration_number",
    "tin",
    "vat_status",
    "small_agri_producer",
    "rsbsa_number",
    "gov_id_type",
    "terms_version",
)

_FILE_LABELS = {
    "rsbsa_file": "RSBSA document",
    "gov_id_file": "Government ID",
    "bir_cert_file": "BIR Certificate of Registration",
}
# The column prefix each upload is stored under.
_DOCUMENT_COLUMNS = {
    "rsbsa_file": "rsbsa_document",
    "gov_id_file": "gov_id_document",
    "bir_cert_file": "bir_cert_document",
}


def _upload(field: str, user_id: int, checked: CheckedFile) -> str:
    # Looked up at call time, so tests can patch r2_service.
    if field == "rsbsa_file":
        return r2_service.upload_rsbsa_document(user_id, checked)
    if field == "gov_id_file":
        return r2_service.upload_gov_id_document(user_id, checked)
    return r2_service.upload_bir_cert_document(user_id, checked)


def _validate_payload(
    parsed: dict[str, Any],
) -> tuple[MerchantOnboardingPayload, dict[str, object] | None]:
    """The payload, and for Submit now the business details its seller type needs.

    Submit later returns no details: only step 1 and the seller type are kept.
    """
    try:
        data = MerchantOnboardingPayload.model_validate(parsed)
    except ValidationError as exc:
        # Name the fields that failed so the form can mark each one.
        raise FieldErrors(_payload_field_errors(exc)) from exc
    if data.submit_mode == "later":
        return data, None
    model = BUSINESS_DETAILS_MODELS[data.seller_type]
    try:
        details = model.model_validate(data.business_fields()).model_dump()
    except ValidationError as exc:
        raise FieldErrors(_payload_field_errors(exc)) from exc
    return data, details


def _check_files_for_mode(
    data: MerchantOnboardingPayload, files: dict[str, UploadFile]
) -> None:
    """Submit later sends no documents; Submit now sends the ones its type needs."""
    if data.submit_mode == "later":
        if files:
            message = "Remove this document, or choose Submit now."
            raise FieldErrors(
                {field: message for field in files}, status_code=422
            )
        return
    needed = ["rsbsa_file", "gov_id_file"]
    if data.seller_type in REGISTERED_SELLERS:
        needed.append("bir_cert_file")
    errors = {
        field: f"{_FILE_LABELS[field]} is required."
        for field in needed
        if field not in files
    }
    for field in files:
        if field not in needed:
            errors[field] = f"{_FILE_LABELS[field]} does not apply to this seller type."
    if errors:
        # 422, as when the files were required form fields.
        raise FieldErrors(errors, status_code=422)


def _apply_operations(
    application: MerchantApplication,
    data: MerchantOnboardingPayload,
    contact_email: str,
    contact_number: str,
    pin: PinCheck | None,
) -> None:
    """Step 1: location, availability and the verified contact details."""
    application.contact_email = contact_email
    # The +639XXXXXXXXX form that was verified (CF-0011).
    application.contact_number = contact_number
    application.region = data.region
    application.province = data.province
    application.city = data.city
    application.barangay = data.barangay
    application.address = data.address
    application.postal_code = data.postal_code
    apply_pin(application, pin, confirmed=data.pin_confirmed)
    application.available_days = data.available_days


def _apply_business_details(
    application: MerchantApplication, seller_type: str, details: dict[str, object]
) -> None:
    """Section 2 for a Submit now. The registration type and the legal name
    are worked out here, never taken from the client."""
    for column in _BUSINESS_COLUMNS:
        setattr(application, column, details.get(column))
    application.registration_type = REGISTRATION_FOR_SELLER[seller_type]
    if seller_type in INDIVIDUAL_SELLERS:
        application.legal_business_name = full_name(
            application.first_name,
            application.middle_name,
            application.last_name,
            application.suffix,
        )
    else:
        application.legal_business_name = application.company_name

    if application.small_agri_producer is None:
        application.small_agri_declared_at = None
        application.small_agri_declared_year = None
    else:
        now = datetime.now(UTC)
        application.small_agri_declared_at = now
        application.small_agri_declared_year = now.year


def _commit(
    db: Session,
    application: MerchantApplication,
    *,
    uploaded: list[str],
    replaced: list[str | None],
) -> MerchantApplication:
    """Save the application; on failure remove this submit's uploads, on
    success the documents it replaced (CF-0040)."""
    try:
        db.commit()
        db.refresh(application)
    except IntegrityError as exc:
        db.rollback()
        _discard_uploads(*uploaded)
        constraint = str(getattr(exc, "orig", exc))
        if "uq_merchant_applications_" in constraint and "_hmac" in constraint:
            raise HTTPException(
                status_code=409,
                detail="This TIN or RSBSA number is already used by another account",
            ) from exc
        raise HTTPException(
            status_code=400, detail="Merchant application could not be saved"
        ) from exc
    except Exception:
        db.rollback()
        _discard_uploads(*uploaded)
        raise

    current = {
        application.rsbsa_document_path,
        application.gov_id_document_path,
        application.bir_cert_document_path,
    }
    stale = [path for path in replaced if path not in current]
    _discard_uploads(*_unreferenced(db, stale))
    return application


def _unreferenced(db: Session, paths: list[str | None]) -> list[str]:
    """``paths`` that no merchant row still points at (CF-0040).

    A closed merchant keeps the documents it was approved with; a resubmit
    must not delete those.
    """
    wanted = {path for path in paths if path}
    if not wanted:
        return []
    in_use = {
        path
        for row in db.query(
            Merchant.rsbsa_document_path,
            Merchant.gov_id_document_path,
            Merchant.bir_cert_document_path,
        )
        .filter(
            Merchant.rsbsa_document_path.in_(wanted)
            | Merchant.gov_id_document_path.in_(wanted)
            | Merchant.bir_cert_document_path.in_(wanted)
        )
        .all()
        for path in row
    }
    return sorted(wanted - in_use)

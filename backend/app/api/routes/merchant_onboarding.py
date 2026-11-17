from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db, require_verified_phone
from app.api.routes.email_otp import MERCHANT_EMAIL_PURPOSE
from app.core.errors import upstream_error
from app.core.field_crypto import blind_index
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.user import User, normalize_email
from app.schemas.merchant_application import (
    MerchantApplicationResponse,
    MerchantOnboardingPayload,
)
from app.services import r2_service, upload_validation
from app.services.application_review import check_can_resubmit
from app.services.merchant_service import get_active_merchant
from app.services.phone_verification import normalize_ph_mobile, read_token
from app.services.pinned_location import validate_pin
from app.services.rate_limit import lock_keys
from app.services.service_area import OUTSIDE_LUZON_DETAIL, is_luzon_region

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
        ("TIN", blind_index(tin), "tin_hmac"),
        ("RSBSA number", blind_index(rsbsa_number), "rsbsa_number_hmac"),
    )
    lock_keys(
        db,
        *(
            f"merchant-identifier:{column}:{digest}"
            for _, digest, column in checks
            if digest
        ),
    )
    for label, digest, column in checks:
        if digest is None:
            continue
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
            raise HTTPException(
                status_code=409,
                detail=f"This {label} is already used by another account",
            )


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
    rsbsa_file: UploadFile = File(...),
    gov_id_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_verified_phone),
):
    try:
        parsed = json.loads(payload)
        data = MerchantOnboardingPayload.model_validate(parsed)
    except Exception as exc:  # noqa: BLE001 - return a clean 400 for any parsing/validation error
        raise HTTPException(
            status_code=400, detail="Invalid onboarding payload"
        ) from exc

    if not is_luzon_region(data.region):
        raise HTTPException(status_code=400, detail=OUTSIDE_LUZON_DETAIL)
    validate_pin(data.lat, data.lng)

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
        raise HTTPException(
            status_code=400, detail="Please verify your contact number first"
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
        raise HTTPException(
            status_code=400, detail="Please verify your contact email first"
        )

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
    # Only a new, rejected or clarification application goes (back) to
    # submitted (CF-0010); checked before the document is uploaded.
    check_can_resubmit(application, has_active_merchant)

    _reject_duplicate_identifiers(db, current_user.id, data.tin, data.rsbsa_number)

    # Both files are checked before either is uploaded.
    checked = upload_validation.check_document_upload(rsbsa_file, "RSBSA document")
    checked_gov_id = upload_validation.check_document_upload(
        gov_id_file, "Government ID"
    )
    try:
        saved_path = r2_service.upload_rsbsa_document(current_user.id, checked)
    except Exception as exc:
        raise upstream_error(
            502, "Document upload failed", log="R2 RSBSA upload failed", exc=exc
        ) from exc
    try:
        gov_id_path = r2_service.upload_gov_id_document(current_user.id, checked_gov_id)
    except Exception as exc:
        _discard_uploads(saved_path)
        raise upstream_error(
            502, "Document upload failed", log="R2 government ID upload failed", exc=exc
        ) from exc

    if application is None:
        application = MerchantApplication(user_id=current_user.id)
        db.add(application)

    application.status = "submitted"
    application.submitted_at = datetime.now(UTC)

    application.merchant_name = data.merchant_name
    application.legal_business_name = data.legal_business_name
    application.business_type = data.business_type
    application.tin = data.tin
    application.registration_type = data.registration_type
    application.registration_number = data.registration_number or None
    application.contact_email = contact_email
    # The +639XXXXXXXXX form that was verified above (CF-0011).
    application.contact_number = f"+{contact}"

    application.region = data.region
    application.province = data.province
    application.city = data.city
    application.barangay = data.barangay
    application.address = data.address
    application.postal_code = data.postal_code
    application.lat = data.lat
    application.lng = data.lng
    application.available_days = data.available_days

    application.rsbsa_number = data.rsbsa_number
    application.rsbsa_document_path = saved_path
    application.rsbsa_document_original_name = upload_validation.safe_filename(
        rsbsa_file.filename
    )
    # The type the server found, not the type the client declared.
    application.rsbsa_document_content_type = checked.content_type
    application.gov_id_type = data.gov_id_type
    application.gov_id_document_path = gov_id_path
    application.gov_id_document_original_name = upload_validation.safe_filename(
        gov_id_file.filename
    )
    application.gov_id_document_content_type = checked_gov_id.content_type

    try:
        db.commit()
        db.refresh(application)
        return application
    except IntegrityError as exc:
        db.rollback()
        _discard_uploads(saved_path, gov_id_path)
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
        _discard_uploads(saved_path, gov_id_path)
        raise

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.user import User
from app.schemas.merchant_application import MerchantApplicationResponse, MerchantOnboardingPayload
from app.services import r2_service

router = APIRouter(tags=["merchant-onboarding"])
logger = logging.getLogger(__name__)


@router.get("/merchant-applications/me", response_model=MerchantApplicationResponse)
async def get_my_merchant_application_route(
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
async def submit_my_merchant_onboarding_route(
    payload: str = Form(...),
    rsbsa_file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        parsed = json.loads(payload)
        data = MerchantOnboardingPayload.model_validate(parsed)
    except Exception as exc:  # noqa: BLE001 - return a clean 400 for any parsing/validation error
        raise HTTPException(status_code=400, detail="Invalid onboarding payload") from exc

    if (db.query(Merchant).filter(Merchant.user_id == current_user.id).first()) is not None:
        raise HTTPException(status_code=409, detail="User already has a merchant profile")

    if rsbsa_file.content_type not in {"application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"}:
        raise HTTPException(status_code=400, detail="RSBSA file must be an image or PDF")

    content = await rsbsa_file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="RSBSA document must be under 20 MB")
    try:
        saved_path = r2_service.upload_rsbsa_document(
            current_user.id, content, rsbsa_file.content_type or "application/octet-stream", rsbsa_file.filename or ""
        )
    except Exception as exc:
        logger.error("R2 RSBSA upload failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail=f"Document upload failed: {exc}") from exc

    application = (
        db.query(MerchantApplication)
        .filter(MerchantApplication.user_id == current_user.id)
        .first()
    )
    if application is None:
        application = MerchantApplication(user_id=current_user.id)
        db.add(application)

    application.status = "submitted"
    application.submitted_at = datetime.now(timezone.utc)

    application.merchant_name = data.merchant_name
    application.legal_business_name = data.legal_business_name
    application.business_type = data.business_type
    application.tin = data.tin
    application.registration_type = data.registration_type
    application.registration_number = data.registration_number
    application.contact_email = str(data.contact_email)
    application.contact_number = data.contact_number

    application.address_line = data.address_line
    application.city = data.city
    application.province = data.province
    application.region = data.region
    application.postal_code = data.postal_code
    application.price_range_min = int(data.price_range_min)
    application.price_range_max = int(data.price_range_max)
    application.available_days = data.available_days

    application.rsbsa_number = data.rsbsa_number
    application.rsbsa_document_path = saved_path
    application.rsbsa_document_original_name = rsbsa_file.filename
    application.rsbsa_document_content_type = rsbsa_file.content_type

    try:
        db.commit()
        db.refresh(application)
        return application
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Merchant application could not be saved") from exc


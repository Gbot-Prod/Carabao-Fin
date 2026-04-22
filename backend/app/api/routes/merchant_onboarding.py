from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.user import User
from app.schemas.merchant import MerchantPageBase, MerchantResponse
from app.schemas.merchant_application import MerchantApplicationResponse, MerchantOnboardingPayload
from app.services.merchant_service import create_merchant

router = APIRouter()


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


def _safe_suffix(filename: str | None, content_type: str | None) -> str:
    if filename:
        suffix = Path(filename).suffix.lower()
        if suffix in {".pdf", ".png", ".jpg", ".jpeg", ".webp"}:
            return suffix
    if content_type == "application/pdf":
        return ".pdf"
    if content_type in {"image/png"}:
        return ".png"
    if content_type in {"image/jpg", "image/jpeg"}:
        return ".jpg"
    if content_type in {"image/webp"}:
        return ".webp"
    return ".bin"


async def _save_rsbsa_upload(user_id: int, rsbsa_file: UploadFile) -> str:
    backend_root = Path(__file__).resolve().parents[3]
    upload_dir = backend_root / "uploads" / "rsbsa"
    upload_dir.mkdir(parents=True, exist_ok=True)

    suffix = _safe_suffix(rsbsa_file.filename, rsbsa_file.content_type)
    filename = f"user_{user_id}_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}_{uuid4().hex}{suffix}"
    full_path = upload_dir / filename

    content = await rsbsa_file.read()
    full_path.write_bytes(content)

    # Store a relative path to keep responses stable across environments.
    return str(Path("uploads") / "rsbsa" / filename)


@router.post("/merchant-onboarding/me", response_model=MerchantResponse)
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

    saved_path = await _save_rsbsa_upload(current_user.id, rsbsa_file)

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

    location = ", ".join([p for p in [data.address_line, data.city, data.province] if p])
    operating_hours = f"Available: {', '.join(data.available_days)}" if data.available_days else None

    merchant_payload = MerchantPageBase(
        user_id=current_user.id,
        merchant_name=data.merchant_name,
        location=location or None,
        contact_number=data.contact_number,
        operating_hours=operating_hours,
        delivery_price=None,
        delivery_time=None,
        rating=None,
    )

    try:
        merchant = create_merchant(db, merchant_payload)
        db.commit()
        db.refresh(application)
        return merchant
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Merchant onboarding could not be saved") from exc


from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ApplicationReviewPayload(BaseModel):
    status: Literal["submitted", "approved", "rejected", "clarification"]
    admin_note: str | None = None


class MerchantOnboardingPayload(BaseModel):
    # Step 1
    merchant_name: str = Field(min_length=3)
    legal_business_name: str = Field(min_length=3)
    business_type: str
    tin: str = Field(min_length=6)
    registration_type: str
    registration_number: str
    contact_email: EmailStr
    contact_number: str = Field(min_length=6)

    # Step 2
    region: str = Field(min_length=1)
    province: str = Field(min_length=1)
    city: str = Field(min_length=1)
    barangay: str = Field(min_length=1)
    address: str = Field(min_length=1)
    postal_code: str = Field(min_length=1)
    delivery_time: int = Field(ge=0)
    delivery_price: int = Field(ge=0)
    price_range_min: int = Field(ge=0)
    price_range_max: int = Field(ge=0)
    available_days: list[str] = Field(min_length=1)

    # Step 3
    rsbsa_number: str | None = None

    # Step 4 — token from /sms/otp/verify proving contact_number was confirmed
    phone_verification_token: str | None = None


class MerchantApplicationResponse(BaseModel):
    id: int
    user_id: int
    merchant_id: int | None = None
    status: str
    submitted_at: datetime | None = None

    merchant_name: str
    legal_business_name: str
    business_type: str
    tin: str | None = None
    registration_type: str | None = None
    registration_number: str | None = None
    contact_email: EmailStr
    contact_number: str

    region: str
    province: str
    city: str
    barangay: str
    address: str
    postal_code: str
    delivery_time: int
    delivery_price: int
    price_range_min: int
    price_range_max: int
    available_days: list[str]

    rsbsa_number: str | None = None
    rsbsa_document_original_name: str | None = None
    rsbsa_document_content_type: str | None = None

    admin_note: str | None = None

    model_config = ConfigDict(from_attributes=True)

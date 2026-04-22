from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field


class MerchantOnboardingPayload(BaseModel):
    # Step 1
    merchant_name: str = Field(min_length=1)
    legal_business_name: str = Field(min_length=1)
    business_type: str = Field(min_length=1)
    tin: Optional[str] = None
    registration_type: Optional[str] = None
    registration_number: Optional[str] = None
    contact_email: EmailStr
    contact_number: str = Field(min_length=6)

    # Step 2
    address_line: str = Field(min_length=1)
    city: str = Field(min_length=1)
    province: str = Field(min_length=1)
    region: Optional[str] = None
    postal_code: Optional[str] = None
    price_range_min: int = Field(ge=0)
    price_range_max: int = Field(ge=0)
    available_days: List[str] = Field(min_length=1)

    # Step 3
    rsbsa_number: Optional[str] = None


class MerchantApplicationResponse(BaseModel):
    id: int
    user_id: int
    status: str
    submitted_at: Optional[datetime] = None

    merchant_name: str
    legal_business_name: str
    business_type: str
    tin: Optional[str] = None
    registration_type: Optional[str] = None
    registration_number: Optional[str] = None
    contact_email: EmailStr
    contact_number: str

    address_line: str
    city: str
    province: str
    region: Optional[str] = None
    postal_code: Optional[str] = None
    price_range_min: int
    price_range_max: int
    available_days: List[str]

    rsbsa_number: Optional[str] = None
    rsbsa_document_path: str
    rsbsa_document_original_name: Optional[str] = None
    rsbsa_document_content_type: Optional[str] = None

    class Config:
        from_attributes = True

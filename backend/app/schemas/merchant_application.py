from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_serializer,
    field_validator,
)

from app.core.field_crypto import mask

# The choices the onboarding form offers (merchantOnboarding/page.tsx).
BusinessType = Literal[
    "Sole Proprietor", "Partnership", "Corporation", "Cooperative", "Farmer"
]
RegistrationType = Literal["DTI", "SEC", "CDA", "LGU"]
Weekday = Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# What an admin may set; "submitted" is set only by the applicant (re)submitting.
# The allowed moves are in app/services/application_review.py (CF-0010).
ReviewStatus = Literal["approved", "rejected", "clarification", "suspended"]

MAX_ADMIN_NOTE = 2000


class ApplicationReviewPayload(BaseModel):
    status: ReviewStatus
    admin_note: str | None = Field(default=None, max_length=MAX_ADMIN_NOTE)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class MerchantOnboardingPayload(BaseModel):
    # Step 1
    merchant_name: str = Field(min_length=3, max_length=100)
    legal_business_name: str = Field(min_length=3, max_length=150)
    business_type: BusinessType
    tin: str = Field(min_length=6, max_length=20)
    registration_type: RegistrationType | None = None
    registration_number: str = Field(default="", max_length=30)
    contact_email: EmailStr
    contact_number: str = Field(min_length=6, max_length=20)

    # Step 2
    region: str = Field(min_length=1, max_length=100)
    province: str = Field(min_length=1, max_length=100)
    city: str = Field(min_length=1, max_length=100)
    barangay: str = Field(min_length=1, max_length=100)
    address: str = Field(min_length=1, max_length=500)
    postal_code: str = Field(min_length=1, max_length=10)
    # Map pin for the farm (U1), optional.
    lat: float | None = None
    lng: float | None = None
    available_days: list[Weekday] = Field(min_length=1, max_length=7)

    # Step 3
    rsbsa_number: str | None = Field(default=None, max_length=30)

    # Step 4: token from /sms/otp/verify proving contact_number was confirmed;
    # not needed when contact_number is the account's own verified phone.
    phone_verification_token: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("registration_type", "rsbsa_number", mode="before")
    @classmethod
    def blank_is_none(cls, value: object) -> object:
        # The form sends "" for "None" / an empty optional field.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("available_days")
    @classmethod
    def unique_days(cls, days: list[str]) -> list[str]:
        if len(days) != len(set(days)):
            raise ValueError("Each day may appear only once")
        return days


class MerchantApplicationResponse(BaseModel):
    """An application as its owner sees it: TIN and RSBSA number are masked."""

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
    available_days: list[str]

    rsbsa_number: str | None = None
    rsbsa_document_original_name: str | None = None
    rsbsa_document_content_type: str | None = None

    admin_note: str | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("tin", "rsbsa_number")
    def _serialize_identifier(self, value: str | None) -> str | None:
        return mask(value)


class AdminMerchantApplicationResponse(MerchantApplicationResponse):
    """Admins review the full TIN and RSBSA number (CF-0007)."""

    @field_serializer("tin", "rsbsa_number")
    def _serialize_identifier(self, value: str | None) -> str | None:
        return value

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
# Valid Philippine government IDs (onboarding section 2). RSBSA is a separate
# upload, not one of these.
GovIdType = Literal[
    "PhilSys National ID",
    "Passport",
    "Driver's License",
    "UMID",
    "SSS",
    "PRC",
    "Postal ID",
    "Voter's ID",
    "PhilHealth",
    "Senior Citizen ID",
    "PWD ID",
]
Weekday = Literal["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# What an admin may set; "submitted" is set only by the applicant (re)submitting.
# The allowed moves are in app/services/application_review.py (CF-0010).
ReviewStatus = Literal["approved", "rejected", "clarification", "suspended"]

MAX_ADMIN_NOTE = 2000
# Shop name and legal business name (onboarding/page.tsx NAME_MAX).
MERCHANT_NAME_MAX = 50


class ApplicationReviewPayload(BaseModel):
    status: ReviewStatus
    admin_note: str | None = Field(default=None, max_length=MAX_ADMIN_NOTE)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class MerchantOnboardingPayload(BaseModel):
    # Section 1: operations and contact
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
    contact_email: EmailStr
    contact_number: str = Field(min_length=6, max_length=20)
    # Tokens from /email/otp/verify and /sms/otp/verify. Not needed when the
    # value is the account's own verified email / phone.
    email_verification_token: str | None = Field(default=None, max_length=2000)
    phone_verification_token: str | None = Field(default=None, max_length=2000)

    # Section 2: legal details and documents
    # The form shows a 0/50 counter for both names (MERCHANT_NAME_MAX).
    merchant_name: str = Field(min_length=3, max_length=MERCHANT_NAME_MAX)
    legal_business_name: str = Field(min_length=3, max_length=MERCHANT_NAME_MAX)
    business_type: BusinessType
    # Optional; a blank value is stored as no TIN.
    tin: str | None = Field(default=None, min_length=6, max_length=20)
    registration_type: RegistrationType | None = None
    registration_number: str = Field(default="", max_length=30)
    rsbsa_number: str | None = Field(default=None, max_length=30)
    gov_id_type: GovIdType

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("tin", "registration_type", "rsbsa_number", mode="before")
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
    gov_id_type: str
    gov_id_document_original_name: str | None = None
    gov_id_document_content_type: str | None = None

    admin_note: str | None = None
    reviewed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("tin", "rsbsa_number")
    def _serialize_identifier(self, value: str | None) -> str | None:
        return mask(value)


class AdminMerchantApplicationResponse(MerchantApplicationResponse):
    """Admins review the full TIN and RSBSA number (CF-0007)."""

    @field_serializer("tin", "rsbsa_number")
    def _serialize_identifier(self, value: str | None) -> str | None:
        return value

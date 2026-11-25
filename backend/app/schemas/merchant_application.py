from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_serializer,
    field_validator,
)

from app.core.field_crypto import mask
from app.schemas.psgc import AreaCodes
from app.schemas.text import one_line

# Who is selling (merchant/onboarding/page.tsx). It decides the name fields,
# the registration agency and the tax fields.
SellerType = Literal[
    "individual_farmer", "sole_proprietor", "corporation", "cooperative"
]
SELLER_TYPES: tuple[str, ...] = (
    "individual_farmer",
    "sole_proprietor",
    "corporation",
    "cooperative",
)
# "now": the business information is sent with this submit. "later": only
# step 1 and the seller type are saved (status pending_documents).
SubmitMode = Literal["now", "later"]
VatStatus = Literal["vat_registered", "non_vat"]
NameSuffix = Literal["Jr.", "Sr.", "II", "III", "IV", "V"]
# Old rows may still hold "LGU"; new submissions only ever derive these.
RegistrationType = Literal["DTI", "SEC", "CDA", "LGU"]

# The registration agency each seller type implies, set by the server (the
# form has no registration type field, so Corporation + DTI cannot happen).
REGISTRATION_FOR_SELLER: dict[str, str | None] = {
    "individual_farmer": None,
    "sole_proprietor": "DTI",
    "corporation": "SEC",
    "cooperative": "CDA",
}
# The registered types: TIN, VAT status and BIR Form 2303 are required.
REGISTERED_SELLERS = frozenset({"sole_proprietor", "corporation", "cooperative"})
# BIR RR No. 12-2023 covers individuals: these see the small agricultural
# producer declaration.
INDIVIDUAL_SELLERS = frozenset({"individual_farmer", "sole_proprietor"})

PERSON_NAME_MAX = 80
COMPANY_NAME_MAX = 255
TERMS_VERSION_MAX = 40

# 9 digits plus a 3-5 digit branch code ("000" when there is no branch).
_TIN_DIGITS = re.compile(r"^\d{12,14}$")


def normalize_tin(value: str) -> str:
    """``123456789000`` or ``123-456-789-000`` as ``123-456-789-000``.

    Raises ValueError unless it is 9 digits plus a 3-5 digit branch code.
    """
    digits = re.sub(r"[\s-]", "", value)
    if not _TIN_DIGITS.match(digits):
        raise ValueError(
            "must be 9 digits plus a 3-5 digit branch code, e.g. 123-456-789-000 "
            "(use 000 if there is no branch)"
        )
    return f"{digits[0:3]}-{digits[3:6]}-{digits[6:9]}-{digits[9:]}"


def full_name(
    first: str | None, middle: str | None, last: str | None, suffix: str | None
) -> str | None:
    """ "First Middle Last Suffix", skipping the empty parts."""
    name = " ".join(part for part in (first, middle, last, suffix) if part)
    return name or None


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

# The parts of an application an admin can send back with a clarification
# request. The applicant can change only these; the other parts stay as sent
# (merchant_onboarding.py). Keep in step with the review page and the form.
ClarificationSection = Literal["store", "location", "contact", "business", "documents"]
CLARIFICATION_SECTIONS: tuple[str, ...] = (
    "store",
    "location",
    "contact",
    "business",
    "documents",
)
# The payload fields each section holds. The terms agreement is not in a
# section: every submit accepts it again.
SECTION_FIELDS: dict[str, tuple[str, ...]] = {
    "store": ("merchant_name",),
    "location": (
        "region",
        "province",
        "city",
        "barangay",
        "region_code",
        "province_code",
        "city_code",
        "barangay_code",
        "address",
        "postal_code",
        "lat",
        "lng",
        "pin_confirmed",
        "available_days",
    ),
    "contact": ("contact_email", "contact_number"),
    "business": (
        "seller_type",
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
    ),
    "documents": ("rsbsa_number", "gov_id_type"),
}


class ApplicationReviewPayload(BaseModel):
    status: ReviewStatus
    # Required for a rejection and a clarification request (application_review.py).
    admin_note: str | None = Field(default=None, max_length=MAX_ADMIN_NOTE)
    # Clarification only: the sections the applicant must change (at least one).
    sections: list[ClarificationSection] = Field(default_factory=list, max_length=5)
    # The checklist items the admin ticked as reviewed (document_checks.py).
    # Approval needs every warn and fail item; other decisions ignore it.
    confirmed_items: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=20
    )

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class MerchantOnboardingPayload(AreaCodes):
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
    # The person placed or moved the pin themselves (not only geocoded).
    pin_confirmed: bool = False
    available_days: list[Weekday] = Field(min_length=1, max_length=7)
    contact_email: EmailStr
    contact_number: str = Field(min_length=6, max_length=20)
    # Tokens from /email/otp/verify and /sms/otp/verify. Not needed when the
    # value is the account's own verified email / phone.
    email_verification_token: str | None = Field(default=None, max_length=2000)
    phone_verification_token: str | None = Field(default=None, max_length=2000)

    # Section 2: business information. Every field here is optional on this
    # model; which ones a submit needs depends on submit_mode and seller_type
    # and is checked by the per-type models below (business_details_model).
    submit_mode: SubmitMode
    seller_type: SellerType
    # The public store name; 0/50 counter on the form (MERCHANT_NAME_MAX).
    merchant_name: str | None = Field(
        default=None, min_length=3, max_length=MERCHANT_NAME_MAX
    )
    # The individual's (or, for a corporation, the authorized
    # representative's) legal name, as on their government ID.
    last_name: str | None = Field(default=None, max_length=PERSON_NAME_MAX)
    first_name: str | None = Field(default=None, max_length=PERSON_NAME_MAX)
    middle_name: str | None = Field(default=None, max_length=PERSON_NAME_MAX)
    suffix: NameSuffix | None = None
    rep_last_name: str | None = Field(default=None, max_length=PERSON_NAME_MAX)
    rep_first_name: str | None = Field(default=None, max_length=PERSON_NAME_MAX)
    rep_middle_name: str | None = Field(default=None, max_length=PERSON_NAME_MAX)
    rep_suffix: NameSuffix | None = None
    company_name: str | None = Field(default=None, max_length=COMPANY_NAME_MAX)
    trade_name: str | None = Field(default=None, max_length=COMPANY_NAME_MAX)
    registration_number: str | None = Field(default=None, max_length=30)
    # Normalized to 999-999-999-000 (normalize_tin).
    tin: str | None = Field(default=None, max_length=20)
    vat_status: VatStatus | None = None
    # BIR RR No. 12-2023 declaration (individual types only).
    small_agri_producer: bool | None = None
    rsbsa_number: str | None = Field(default=None, max_length=30)
    gov_id_type: GovIdType | None = None
    terms_accepted: bool = False
    terms_version: str | None = Field(default=None, max_length=TERMS_VERSION_MAX)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    # Item 6: no control, zero-width or bidi characters; one space between words.
    _one_line = field_validator(
        "region",
        "province",
        "city",
        "barangay",
        "address",
        "postal_code",
        mode="before",
    )(one_line)

    @field_validator(
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
        "rsbsa_number",
        "gov_id_type",
        "terms_version",
        mode="before",
    )
    @classmethod
    def blank_is_none(cls, value: object) -> object:
        # The form sends "" for an empty optional field.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("tin")
    @classmethod
    def tin_format(cls, value: str | None) -> str | None:
        return normalize_tin(value) if value is not None else None

    @field_validator("available_days")
    @classmethod
    def unique_days(cls, days: list[str]) -> list[str]:
        if len(days) != len(set(days)):
            raise ValueError("Each day may appear only once")
        return days

    def business_fields(self) -> dict[str, object]:
        """The section 2 values that were filled in, for the per-type check."""
        return {
            name: value
            for name in BUSINESS_FIELDS
            if (value := getattr(self, name)) is not None
        }


# The section 2 fields a Submit now is checked against (one model per type).
BUSINESS_FIELDS = (
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
    "terms_accepted",
    "terms_version",
)

PersonName = Annotated[str, Field(min_length=1, max_length=PERSON_NAME_MAX)]
CompanyName = Annotated[str, Field(min_length=1, max_length=COMPANY_NAME_MAX)]


class _SubmitNowCommon(BaseModel):
    """What every Submit now needs. A field a type does not use is refused
    (extra="forbid"), e.g. a small producer declaration from a corporation."""

    merchant_name: str = Field(min_length=3, max_length=MERCHANT_NAME_MAX)
    rsbsa_number: str | None = None
    gov_id_type: GovIdType
    # The Terms and Data Privacy checkbox.
    terms_accepted: Literal[True]
    terms_version: str = Field(min_length=1, max_length=TERMS_VERSION_MAX)

    model_config = ConfigDict(extra="forbid")


class _Person(BaseModel):
    last_name: PersonName
    first_name: PersonName
    middle_name: str | None = None
    suffix: NameSuffix | None = None


class _Registered(BaseModel):
    registration_number: str = Field(min_length=1, max_length=30)
    tin: str
    vat_status: VatStatus


class IndividualFarmerDetails(_SubmitNowCommon, _Person):
    # "You can add this later."
    tin: str | None = None
    small_agri_producer: bool


class SoleProprietorDetails(_SubmitNowCommon, _Person, _Registered):
    trade_name: CompanyName
    small_agri_producer: bool


class CorporationDetails(_SubmitNowCommon, _Registered):
    """Corporation, partnership or one person corporation (SEC)."""

    company_name: CompanyName
    trade_name: CompanyName
    # The authorized representative; the government ID upload is theirs.
    rep_last_name: PersonName
    rep_first_name: PersonName
    rep_middle_name: str | None = None
    rep_suffix: NameSuffix | None = None


class CooperativeDetails(_SubmitNowCommon, _Registered):
    company_name: CompanyName
    trade_name: str | None = None


BUSINESS_DETAILS_MODELS: dict[str, type[_SubmitNowCommon]] = {
    "individual_farmer": IndividualFarmerDetails,
    "sole_proprietor": SoleProprietorDetails,
    "corporation": CorporationDetails,
    "cooperative": CooperativeDetails,
}


class MerchantApplicationResponse(BaseModel):
    """An application as its owner sees it: TIN and RSBSA number are masked."""

    id: int
    user_id: int
    merchant_id: int | None = None
    status: str
    submitted_at: datetime | None = None

    # Unset on a pending_documents application (only step 1 was sent).
    merchant_name: str | None = None
    legal_business_name: str | None = None
    seller_type: str | None = None
    last_name: str | None = None
    first_name: str | None = None
    middle_name: str | None = None
    suffix: str | None = None
    rep_last_name: str | None = None
    rep_first_name: str | None = None
    rep_middle_name: str | None = None
    rep_suffix: str | None = None
    company_name: str | None = None
    trade_name: str | None = None
    vat_status: str | None = None
    bir_cert_document_original_name: str | None = None
    bir_cert_document_content_type: str | None = None
    small_agri_producer: bool | None = None
    small_agri_declared_at: datetime | None = None
    small_agri_declared_year: int | None = None
    terms_accepted_at: datetime | None = None
    terms_version: str | None = None
    tin: str | None = None
    registration_type: str | None = None
    registration_number: str | None = None
    contact_email: EmailStr
    contact_number: str

    region: str
    province: str
    city: str
    barangay: str | None = None
    region_code: str | None = None
    province_code: str | None = None
    city_code: str | None = None
    barangay_code: str | None = None
    address: str
    postal_code: str
    available_days: list[str]
    # The farm pin from step 1, so finishing the application later keeps it.
    lat: float | None = None
    lng: float | None = None
    pin_confirmed: bool = False
    # True: the pin is outside the chosen city/barangay (services/pin_area.py).
    pin_area_mismatch: bool | None = None

    rsbsa_number: str | None = None
    rsbsa_document_original_name: str | None = None
    rsbsa_document_content_type: str | None = None
    gov_id_type: str | None = None
    gov_id_document_original_name: str | None = None
    gov_id_document_content_type: str | None = None

    admin_note: str | None = None
    reviewed_at: datetime | None = None
    # Clarification: the sections the admin flagged. None: every section is open.
    clarification_sections: list[str] | None = None

    model_config = ConfigDict(from_attributes=True)

    @field_serializer("tin", "rsbsa_number")
    def _serialize_identifier(self, value: str | None) -> str | None:
        return mask(value)


class ChecklistItem(BaseModel):
    """One automated review check (services/document_checks.py)."""

    id: str
    label: str
    result: Literal["pass", "warn", "fail", "not_checked"]
    reason: str
    # Which uploaded document it is about (rsbsa, gov_id, bir_cert), if any.
    document: str | None = None
    # Other applications with the same number or file (duplicates check).
    related_application_ids: list[int] = []


class AdminMerchantApplicationResponse(MerchantApplicationResponse):
    """Admins review the full TIN and RSBSA number (CF-0007), and see the
    automated checklist. The OCR text and numbers are never sent."""

    check_status: str | None = None
    checked_at: datetime | None = None
    name_match_score: float | None = None
    check_checklist: list[ChecklistItem] | None = None
    check_confirmations: dict[str, dict] | None = None

    @field_serializer("tin", "rsbsa_number")
    def _serialize_identifier(self, value: str | None) -> str | None:
        return value

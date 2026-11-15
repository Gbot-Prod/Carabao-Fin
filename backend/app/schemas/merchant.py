from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.schemas.merchant_application import Weekday
from app.schemas.produce import ProduceResponse

# Columns that must keep a value once the shop exists.
_REQUIRED = ("merchant_name", "region", "province", "address", "postal_code")


class MerchantUpdate(BaseModel):
    """PATCH /merchants/me. Same limits as onboarding (CF-0030)."""

    merchant_name: str | None = Field(default=None, min_length=3, max_length=100)
    contact_email: EmailStr | None = None
    # Normalized to +639XXXXXXXXX; a change needs phone_verification_token.
    contact_number: str | None = Field(default=None, min_length=6, max_length=20)
    # From /sms/otp/verify for the new contact_number.
    phone_verification_token: str | None = Field(default=None, max_length=2000)
    region: str | None = Field(default=None, min_length=1, max_length=100)
    province: str | None = Field(default=None, min_length=1, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    barangay: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, min_length=1, max_length=500)
    postal_code: str | None = Field(default=None, min_length=1, max_length=10)
    lat: float | None = None
    lng: float | None = None
    available_days: list[Weekday] | None = Field(
        default=None, min_length=1, max_length=7
    )
    # Flat fee per order, in pesos (CF-0020).
    delivery_price: int | None = Field(default=None, ge=0, le=100_000)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator(*_REQUIRED, "available_days")
    @classmethod
    def not_null(cls, value: object) -> object:
        # Runs only for a field the client sent; null would break a NOT NULL column.
        if value is None:
            raise ValueError("This field cannot be empty")
        return value

    @field_validator("available_days")
    @classmethod
    def unique_days(cls, days: list[str]) -> list[str]:
        if len(days) != len(set(days)):
            raise ValueError("Each day may appear only once")
        return days


class MerchantShopResponse(BaseModel):
    id: int
    title: str
    slug: str
    banner_image_url: str | None = None
    description: str | None = None

    model_config = ConfigDict(from_attributes=True)


class MerchantResponse(BaseModel):
    id: int
    user_id: int
    merchant_name: str
    legal_business_name: str | None = None
    contact_email: EmailStr | None = None
    contact_number: str | None = None

    region: str
    province: str
    city: str | None = None
    barangay: str | None = None
    address: str
    postal_code: str
    # Map pin (U1).
    lat: float | None = None
    lng: float | None = None

    available_days: list[str]
    operating_hours: Any
    delivery_price: int | None = None
    delivery_time: int | None = None
    rating: float | None = None
    rating_count: int = 0
    deleted_at: datetime | None = None

    shop_page: MerchantShopResponse | None = None
    produces: list[ProduceResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class AdminMerchantResponse(MerchantResponse):
    # The owner's account suspension (A3); a suspended merchant is hidden.
    owner_is_suspended: bool = False
    owner_suspension_reason: str | None = None


class MerchantDetailResponse(MerchantResponse):
    """Public merchant profile, plus the owning user's name for transparency."""

    owner_name: str | None = None

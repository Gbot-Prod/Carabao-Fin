from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.schemas.merchant_application import MERCHANT_NAME_MAX, Weekday
from app.schemas.produce import ProduceResponse

# Columns that must keep a value once the shop exists.
_REQUIRED = ("merchant_name", "region", "province", "address", "postal_code")


class MerchantUpdate(BaseModel):
    """PATCH /merchants/me. Same limits as onboarding (CF-0030)."""

    merchant_name: str | None = Field(
        default=None, min_length=3, max_length=MERCHANT_NAME_MAX
    )
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
    # The owner placed or moved the pin themselves (not only geocoded).
    pin_confirmed: bool | None = None
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
    logo_url: str | None = None
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
    pin_confirmed: bool = False

    available_days: list[str]
    operating_hours: Any
    delivery_price: int | None = None
    delivery_time: int | None = None
    rating: float | None = None
    rating_count: int = 0
    deleted_at: datetime | None = None
    # Sitemap lastModified on the web (CF-0041).
    updated_at: datetime | None = None
    # CF-0066: holiday mode; the farm takes no orders through this day.
    paused_until: date | None = None
    pause_message: str | None = None

    shop_page: MerchantShopResponse | None = None
    produces: list[ProduceResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class AdminMerchantResponse(MerchantResponse):
    # The owner's account suspension (A3); a suspended merchant is hidden.
    owner_is_suspended: bool = False
    owner_suspension_reason: str | None = None
    # Details for the admin's expanded row. No encrypted IDs (TIN, RSBSA).
    owner_name: str | None = None
    business_type: str | None = None
    registration_type: str | None = None
    registration_number: str | None = None
    low_stock_threshold: int | None = None
    created_at: datetime | None = None
    verified_at: datetime | None = None


class StorePauseIn(BaseModel):
    """CF-0066: pause orders through ``paused_until`` (Manila calendar)."""

    paused_until: date
    message: str | None = Field(default=None, max_length=200)

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PublicMerchantResponse(BaseModel):
    """A farm as anyone browsing sees it (CF-0048, B45).

    Leaves out what can locate the owner's home or isn't for the public:
    street ``address``, ``barangay``, the map pin ``lat``/``lng``,
    ``legal_business_name`` and the owner's ``user_id``. Many farms are
    someone's home (same rule as the web JSON-LD in lib/structured-data.ts).
    The contact number and email stay: the farm page and the mobile farm
    screen show them so buyers can reach the farm. The owner reads the full
    profile from ``GET /merchants/me``.
    """

    id: int
    merchant_name: str
    contact_email: EmailStr | None = None
    contact_number: str | None = None

    region: str
    province: str
    city: str | None = None
    postal_code: str

    available_days: list[str]
    operating_hours: Any
    delivery_price: int | None = None
    delivery_time: int | None = None
    rating: float | None = None
    rating_count: int = 0
    updated_at: datetime | None = None
    # CF-0066: holiday mode; the farm takes no orders through this day.
    paused_until: date | None = None
    pause_message: str | None = None

    shop_page: MerchantShopResponse | None = None
    produces: list[ProduceResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class PublicMerchantDetailResponse(PublicMerchantResponse):
    """Public farm profile plus the owning user's name for transparency."""

    owner_name: str | None = None

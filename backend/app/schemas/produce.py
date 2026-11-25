from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.statuses import ProduceStatus

MAX_PRICE_TIERS = 5
# Whole pesos per sale unit (CF-0014): a listing price is never 0 or negative.
MAX_PRICE = 1_000_000
# Backed by a CHECK on produces.stock_quantity >= 0 (CF-0009).
MAX_STOCK = 10_000_000
# CF-0042 (main) / CF-0051 (web loop): input limits for a listing. Kept in
# step with the web form (maxLength in merchant/components/ProduceFormFields.tsx,
# SYSTEM_REFERENCE §3). Responses don't use them, so older rows still serialize.
MAX_NAME = 100
MAX_DESCRIPTION = 2000
# Sale-unit size ("1.5 kg"): positive, or per-unit math divides by 0 or flips sign.
MAX_UNIT_QUANTITY = 1000.0


class PriceTier(BaseModel):
    """Unit price once a cart line reaches ``min_qty`` sale units."""

    min_qty: int = Field(ge=2)
    unit_price: int = Field(ge=1, le=MAX_PRICE)  # pesos


class ProduceBase(BaseModel):
    name: str
    description: str | None = None
    category: Literal["Vegetables", "Fruits"] | None = None
    price: int
    unit: Literal["kg"] = "kg"
    unit_quantity: float = 1.0
    stock_quantity: int = 0
    image_url: str | None = None
    harvest_date: date | None = None
    best_before: date | None = None
    min_order_qty: int = Field(default=1, ge=1)
    price_tiers: list[PriceTier] = Field(
        default_factory=list, max_length=MAX_PRICE_TIERS
    )


class ProduceCreate(ProduceBase):
    # CF-0042: limits apply to what clients send, not to responses.
    name: str = Field(min_length=1, max_length=MAX_NAME)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION)
    price: int = Field(ge=1, le=MAX_PRICE)
    unit_quantity: float = Field(default=1.0, gt=0, le=MAX_UNIT_QUANTITY)
    stock_quantity: int = Field(default=0, ge=0, le=MAX_STOCK)
    harvest_date: date
    best_before: date

    model_config = ConfigDict(extra="forbid")


class ProduceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=MAX_NAME)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION)
    category: Literal["Vegetables", "Fruits"] | None = None
    price: int | None = Field(default=None, ge=1, le=MAX_PRICE)
    unit: Literal["kg"] | None = None
    unit_quantity: float | None = Field(default=None, gt=0, le=MAX_UNIT_QUANTITY)
    stock_quantity: int | None = Field(default=None, ge=0, le=MAX_STOCK)
    # CF-0049: the stock the merchant's form loaded. When sent with
    # stock_quantity and the row has changed since (a checkout or cancel), the
    # update is refused with 409 instead of overwriting that change.
    expected_stock_quantity: int | None = Field(default=None, ge=0, le=MAX_STOCK)
    image_url: str | None = None
    harvest_date: date | None = None
    best_before: date | None = None
    # Not nullable: only applied when sent (the route uses exclude_unset).
    min_order_qty: int = Field(default=1, ge=1)
    price_tiers: list[PriceTier] = Field(
        default_factory=list, max_length=MAX_PRICE_TIERS
    )

    @field_validator("category", mode="before")
    @classmethod
    def coerce_empty_category(cls, v: object) -> object:
        return None if v == "" else v


class ProduceResponse(ProduceBase):
    id: int
    merchant_id: int
    # Admin moderation (A6); buyers never receive hidden listings.
    hidden_at: datetime | None = None
    hidden_reason: str | None = None
    # Guardrails Phase 1: buyers see live and under_review listings.
    status: ProduceStatus = ProduceStatus.LIVE

    model_config = ConfigDict(from_attributes=True)

    @field_validator("status", mode="before")
    @classmethod
    def unsaved_status(cls, v: object) -> object:
        # A row that is not flushed yet has no column default applied.
        return ProduceStatus.LIVE if v is None else v


class ListingIssue(BaseModel):
    """One result of the listing checker (services/listing_checks.py)."""

    field: str
    code: str
    message: str
    suggestion: str | None = None


class MerchantProduceResponse(ProduceResponse):
    """A listing as its own farm (and admins) see it: with the review state."""

    review_flags: list[ListingIssue] = Field(default_factory=list)
    submitted_for_review_at: datetime | None = None
    reviewed_at: datetime | None = None
    rejection_code: str | None = None
    rejection_reason: str | None = None

    @field_validator("review_flags", mode="before")
    @classmethod
    def none_to_list(cls, v: object) -> object:
        return v or []


class ProduceCheckRequest(BaseModel):
    """POST /produce/check: the form as it is now; every field may be missing.

    ``produce_id`` is the listing being edited (left out of the duplicate check).
    The limits are the same as ProduceCreate, so a value the save would refuse
    is a 422 here too.
    """

    model_config = ConfigDict(extra="forbid")

    produce_id: int | None = Field(default=None, ge=1)
    name: str | None = Field(default=None, max_length=MAX_NAME)
    description: str | None = Field(default=None, max_length=MAX_DESCRIPTION)
    category: Literal["Vegetables", "Fruits"] | None = None
    price: int | None = Field(default=None, ge=1, le=MAX_PRICE)
    unit: Literal["kg"] | None = None
    unit_quantity: float | None = Field(default=None, gt=0, le=MAX_UNIT_QUANTITY)
    stock_quantity: int | None = Field(default=None, ge=0, le=MAX_STOCK)
    harvest_date: date | None = None
    best_before: date | None = None
    min_order_qty: int | None = Field(default=None, ge=1)
    price_tiers: list[PriceTier] = Field(
        default_factory=list, max_length=MAX_PRICE_TIERS
    )

    @field_validator("category", mode="before")
    @classmethod
    def coerce_empty_category(cls, v: object) -> object:
        return None if v == "" else v


class MarketPriceView(BaseModel):
    """The NCR market price for the produce (listing_checks.MarketPrice).

    The form recommends ``recommended_max`` pesos per kg or less: buyers
    expect a farm price below the NCR retail price. Null when no usable
    reference row matches the name.
    """

    commodity: str
    low: int
    high: int
    unit: str
    source: str
    as_of: date
    recommended_max: int
    price_per_kg: float | None = None


class ProduceCheckResponse(BaseModel):
    valid: bool
    has_hard_blocks: bool
    has_soft_flags: bool
    recommended_status: ProduceStatus
    hard_blocks: list[ListingIssue]
    soft_flags: list[ListingIssue]
    market_price: MarketPriceView | None = None


class ListingPenaltyView(BaseModel):
    """One penalty row (guardrails Phase 2, services/listing_trust.py)."""

    id: int
    produce_id: int | None = None
    produce_name: str
    code: str
    label: str
    points: int
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None = None
    revoke_reason: str | None = None


class ListingStandingResponse(BaseModel):
    """GET /merchants/me/listing-standing: points and the limits they hit."""

    points: int
    window_days: int
    listing_block_points: int
    account_review_points: int
    can_create_listings: bool
    blocked_until: datetime | None = None
    # Listings an admin must still approve before new ones go live at once.
    new_merchant_reviews_left: int
    penalties: list[ListingPenaltyView]


class SavedProduceResponse(ProduceResponse):
    """A saved listing as its buyer sees it (CF-0038), with where it is from."""

    merchant_name: str
    merchant_province: str | None = None
    merchant_city: str | None = None
    saved_at: datetime

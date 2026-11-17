from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_PRICE_TIERS = 5
# Whole pesos per sale unit (CF-0014): a listing price is never 0 or negative.
MAX_PRICE = 1_000_000
# Backed by a CHECK on produces.stock_quantity >= 0 (CF-0009).
MAX_STOCK = 10_000_000


class PriceTier(BaseModel):
    """Unit price once a cart line reaches ``min_qty`` sale units."""

    min_qty: int = Field(ge=2)
    unit_price: int = Field(ge=1, le=MAX_PRICE)  # pesos


class ProduceBase(BaseModel):
    name: str
    description: str | None = None
    category: Literal["Vegetables", "Fruits"] | None = None
    price: int
    unit: Literal["kg", "lbs"] = "kg"
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
    price: int = Field(ge=1, le=MAX_PRICE)
    stock_quantity: int = Field(default=0, ge=0, le=MAX_STOCK)
    harvest_date: date
    best_before: date


class ProduceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: Literal["Vegetables", "Fruits"] | None = None
    price: int | None = Field(default=None, ge=1, le=MAX_PRICE)
    unit: Literal["kg", "lbs"] | None = None
    unit_quantity: float | None = None
    stock_quantity: int | None = Field(default=None, ge=0, le=MAX_STOCK)
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

    model_config = ConfigDict(from_attributes=True)


class SavedProduceResponse(ProduceResponse):
    """A saved listing as its buyer sees it (CF-0038), with where it is from."""

    merchant_name: str
    merchant_province: str | None = None
    merchant_city: str | None = None
    saved_at: datetime

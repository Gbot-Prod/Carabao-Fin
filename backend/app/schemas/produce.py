from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_PRICE_TIERS = 5


class PriceTier(BaseModel):
    """Unit price once a cart line reaches ``min_qty`` sale units."""

    min_qty: int = Field(ge=2)
    unit_price: int = Field(ge=1)  # pesos


class ProduceBase(BaseModel):
    name: str
    description: str | None = None
    category: Literal["Vegetables", "Fruits"] | None = None
    price: int = 0
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
    harvest_date: date
    best_before: date


class ProduceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: Literal["Vegetables", "Fruits"] | None = None
    price: int | None = None
    unit: Literal["kg", "lbs"] | None = None
    unit_quantity: float | None = None
    stock_quantity: int | None = None
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

    model_config = ConfigDict(from_attributes=True)

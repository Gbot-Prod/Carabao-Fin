from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator


class ProduceBase(BaseModel):
    name: str
    description: str | None = None
    category: Literal["Vegetables", "Fruits"] | None = None
    price: int = 0
    unit: Literal["kg", "lbs"] = "kg"
    unit_quantity: float = 1.0
    stock_quantity: int = 0
    image_url: str | None = None


class ProduceCreate(ProduceBase):
    pass


class ProduceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    category: Literal["Vegetables", "Fruits"] | None = None
    price: int | None = None
    unit: Literal["kg", "lbs"] | None = None
    unit_quantity: float | None = None
    stock_quantity: int | None = None
    image_url: str | None = None

    @field_validator("category", mode="before")
    @classmethod
    def coerce_empty_category(cls, v: object) -> object:
        return None if v == "" else v


class ProduceResponse(ProduceBase):
    id: int
    merchant_id: int

    model_config = ConfigDict(from_attributes=True)

from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, field_validator


class ProduceBase(BaseModel):
    name: str
    description: Optional[str] = None
    category: Optional[Literal["Vegetables", "Fruits"]] = None
    price: int = 0
    unit: Literal["kg", "lbs"] = "kg"
    unit_quantity: float = 1.0
    stock_quantity: int = 0
    image_url: Optional[str] = None


class ProduceCreate(ProduceBase):
    pass


class ProduceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[Literal["Vegetables", "Fruits"]] = None
    price: Optional[int] = None
    unit: Optional[Literal["kg", "lbs"]] = None
    unit_quantity: Optional[float] = None
    stock_quantity: Optional[int] = None
    image_url: Optional[str] = None

    @field_validator("category", mode="before")
    @classmethod
    def coerce_empty_category(cls, v: object) -> object:
        return None if v == "" else v


class ProduceResponse(ProduceBase):
    id: int
    merchant_id: int

    model_config = ConfigDict(from_attributes=True)

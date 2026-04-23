from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class CartItem(BaseModel):
    id: Optional[str] = None
    produce_id: Optional[int] = None
    merchant_id: Optional[int] = None
    name: Optional[str] = None
    produce: Optional[str] = None
    price: float = 0
    quantity: int = 0
    unit: Optional[str] = None
    image: Optional[str] = None
    farm: Optional[str] = None
    merchant: Optional[str] = None

    model_config = ConfigDict(extra="allow")


class CartBase(BaseModel):
    items: list[CartItem] = Field(default_factory=list)
    total_items: int = 0
    total_price: int = 0


class CartCreate(CartBase):
    user_id: int


class CartUpdate(BaseModel):
    items: list[CartItem] | None = None
    total_items: int | None = None
    total_price: int | None = None


class CartResponse(BaseModel):
    id: int
    user_id: int
    items: list[CartItem] = Field(default_factory=list)
    total_items: int = 0
    total_price: int = 0

    model_config = ConfigDict(from_attributes=True)

from typing import Optional
from pydantic import BaseModel, Field


class CartItem(BaseModel):
    produce_id: int
    merchant_id: int
    name: str
    price: int
    quantity: int
    unit: Optional[str] = None
    image: Optional[str] = None
    farm: Optional[str] = None
    merchant: Optional[str] = None


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

    class Config:
        from_attributes = True

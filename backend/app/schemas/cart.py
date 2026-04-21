from typing import Any

from pydantic import BaseModel, Field


class CartBase(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    total_items: int = 0
    total_price: int = 0


class CartCreate(CartBase):
    user_id: int


class CartUpdate(BaseModel):
    items: list[dict[str, Any]] | None = None
    total_items: int | None = None
    total_price: int | None = None


class CartResponse(CartBase):
    id: int
    user_id: int

    class Config:
        from_attributes = True
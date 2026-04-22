from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class OrderItemResponse(BaseModel):
    id: int
    order_id: int
    merchant: str
    merchant_id: Optional[int] = None
    merchant_page_slug: Optional[str] = None
    total_amount: int
    order_date: datetime
    status: str
    items: list[dict[str, Any]]

    model_config = ConfigDict(from_attributes=True)


class CurrentOrderResponse(BaseModel):
    id: int
    order_id: int
    merchant: str
    merchant_id: Optional[int] = None
    merchant_page_slug: Optional[str] = None
    shipped: bool
    date_bought: datetime
    time_of_arrival: Optional[datetime] = None
    delivery_fee: int
    image: Optional[str] = None
    status: str

    model_config = ConfigDict(from_attributes=True)


class PlaceOrderRequest(BaseModel):
    delivery_date: Optional[str] = None
    delivery_time: Optional[str] = None
    payment_method: Optional[str] = None
    notes: Optional[str] = None
    service_fee: int = 40
    image: Optional[str] = None


class PlaceOrderResponse(BaseModel):
    order_id: int
    order_reference: str
    status: str
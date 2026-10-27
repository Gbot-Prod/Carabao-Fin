from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class OrderItemResponse(BaseModel):
    id: int
    order_id: int
    merchant: str
    merchant_id: int | None = None
    merchant_page_slug: str | None = None
    total_amount: int
    order_date: datetime
    status: str
    items: list[dict[str, Any]]

    model_config = ConfigDict(from_attributes=True)


class CurrentOrderResponse(BaseModel):
    id: int
    order_id: int
    merchant: str
    merchant_id: int | None = None
    merchant_page_slug: str | None = None
    shipped: bool
    date_bought: datetime
    time_of_arrival: datetime | None = None
    delivery_fee: int
    image: str | None = None
    status: str
    items: list[dict[str, Any]] = []

    model_config = ConfigDict(from_attributes=True)


class PlaceOrderRequest(BaseModel):
    delivery_date: str | None = None
    delivery_time: str | None = None
    delivery_address: str | None = None
    payment_method: str | None = None
    notes: str | None = None
    service_fee: int = 40
    image: str | None = None


class PlaceOrderResponse(BaseModel):
    order_id: int
    order_reference: str
    status: str

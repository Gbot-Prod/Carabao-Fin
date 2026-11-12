from __future__ import annotations

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.statuses import OrderStatus, PaymentStatus
from app.schemas.review import ReviewResponse


class OrderItemResponse(BaseModel):
    id: int
    order_id: int
    merchant: str
    merchant_id: int | None = None
    merchant_page_slug: str | None = None
    merchant_logo_url: str | None = None
    total_amount: int
    order_date: datetime
    status: OrderStatus
    payment_status: PaymentStatus
    items: list[dict[str, Any]]
    delivery_address: str | None = None
    requested_delivery_date: date | None = None
    delivery_window: str | None = None
    notes: str | None = None

    model_config = ConfigDict(from_attributes=True)


class CurrentOrderResponse(BaseModel):
    id: int
    order_id: int
    merchant: str
    merchant_id: int | None = None
    merchant_page_slug: str | None = None
    merchant_logo_url: str | None = None
    shipped: bool
    date_bought: datetime
    time_of_arrival: datetime | None = None
    shipped_at: datetime | None = None
    auto_confirm_at: datetime | None = None
    delivery_fee: int
    image: str | None = None
    status: OrderStatus
    payment_status: PaymentStatus
    items: list[dict[str, Any]] = []
    total_amount: int = 0
    delivery_address: str | None = None
    requested_delivery_date: date | None = None
    delivery_window: str | None = None
    notes: str | None = None

    model_config = ConfigDict(from_attributes=True)


class OrderDetailResponse(CurrentOrderResponse):
    """One buyer order with everything the order detail page shows."""

    delivered_at: datetime | None = None
    delivery_confirmed_by: str | None = None
    review: ReviewResponse | None = None
    can_review: bool = False
    review_deadline: datetime | None = None


class PlaceOrderRequest(BaseModel):
    delivery_date: date | None = None
    # A time window such as "08:00 – 10:00"; stored as Order.delivery_window.
    delivery_time: str | None = Field(default=None, max_length=50)
    delivery_address: str | None = None
    # The region picked at checkout (web). When absent, delivery_address is checked
    # for a Luzon province or Metro Manila city instead (B2).
    delivery_region: str | None = Field(default=None, max_length=100)
    payment_method: str | None = None
    notes: str | None = Field(default=None, max_length=500)
    service_fee: int = 40
    image: str | None = None


class PlacedOrder(BaseModel):
    order_id: int
    order_reference: str
    status: OrderStatus
    merchant_id: int
    merchant_name: str
    total_price: int
    delivery_fee: int


class PlaceOrderResponse(BaseModel):
    # The first order, for clients that place one merchant's cart at a time.
    order_id: int
    order_reference: str
    status: OrderStatus
    # Every order created: one per merchant in the cart (C1), merchant id order.
    orders: list[PlacedOrder] = []

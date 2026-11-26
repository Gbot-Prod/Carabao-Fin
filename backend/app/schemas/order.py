from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.statuses import OrderStatus, PaymentStatus
from app.schemas.review import ReviewResponse
from app.schemas.text import one_line


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
    notes: str | None = None
    # The buyer's tabbed order list shows these on each card.
    delivery_fee: int = 0
    time_of_arrival: datetime | None = None
    auto_confirm_at: datetime | None = None
    delivered_at: datetime | None = None
    reviewed: bool = False
    can_review: bool = False
    review_deadline: datetime | None = None

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
    notes: str | None = None

    model_config = ConfigDict(from_attributes=True)


class OrderDetailResponse(CurrentOrderResponse):
    """One buyer order with everything the order detail page shows."""

    delivered_at: datetime | None = None
    delivery_confirmed_by: str | None = None
    # Why it was cancelled, as the buyer was told; None otherwise.
    cancel_reason: str | None = None
    review: ReviewResponse | None = None
    can_review: bool = False
    review_deadline: datetime | None = None
    # ORDER_PROOF_PHOTOS_PLAN.md: the proof photos the buyer may see
    # (packing, dropoff); GET /orders/me/{id}/proof/{kind} serves each one.
    proof_photos: list[str] = []
    # A merchant-set delivery: the buyer can tap "I did not get this" until
    # dispute_until, if they did not confirm it.
    dispute_until: datetime | None = None
    can_dispute: bool = False
    delivery_buyer_confirmed_at: datetime | None = None
    delivery_disputed_at: datetime | None = None
    dispute_resolution: str | None = None


class PlaceOrderRequest(BaseModel):
    """Checkout options. Items, prices and fees come from the cart and the
    produce rows on the server, never from this body (CF-0012)."""

    # The farm picks when to deliver (it ships from Ready to ship); the buyer
    # sends no date or time window.
    # One of the buyer's saved addresses. The server then takes the address
    # text, the PSGC area and the pin from that row, and the five fields below
    # (delivery_address ... delivery_pin_confirmed) must be left out.
    delivery_address_id: int | None = Field(default=None, ge=1)
    delivery_address: str | None = Field(default=None, max_length=500)
    # Without delivery_address_id: the region picked at checkout (web). When
    # absent, delivery_address is checked for a Luzon province or Metro Manila
    # city instead (B2).
    delivery_region: str | None = Field(default=None, max_length=100)
    # Map pin for the delivery address (U1), optional.
    delivery_lat: float | None = None
    delivery_lng: float | None = None
    # The buyer placed or moved the pin themselves. Left out (mobile): it is
    # confirmed when it is a confirmed pin of one of the buyer's saved addresses.
    delivery_pin_confirmed: bool | None = None
    notes: str | None = Field(default=None, max_length=500)
    # The cart lines the buyer ticked, by produce ID. None means the whole cart.
    # Quantities and prices still come from the saved cart, never from here.
    produce_ids: list[int] | None = Field(default=None, min_length=1, max_length=200)

    model_config = ConfigDict(extra="forbid")

    # Item 6: no control, zero-width or bidi characters; one space between words.
    _one_line = field_validator("delivery_address", "delivery_region", mode="before")(
        one_line
    )


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

from datetime import date, datetime
from typing import Any

from pydantic import BaseModel

from app.models.statuses import PaymentStatus


class AdminOrderSummary(BaseModel):
    id: int
    status: str
    payment_status: PaymentStatus
    total_price: int
    delivery_fee: int
    ordered_at: datetime
    merchant_id: int | None
    merchant_name: str | None
    buyer_id: int | None
    buyer_name: str | None
    buyer_email: str | None
    shipment_id: int | None


class AdminOrderTransaction(BaseModel):
    id: int
    status: str
    amount: int
    platform_fee: int
    merchant_amount: int
    paymongo_payment_id: str | None
    created_at: datetime
    paid_at: datetime | None


class AdminOrderShipment(BaseModel):
    id: int
    status: str
    stop_count: int
    shipped_at: datetime | None


class AdminOrderDelivery(BaseModel):
    delivery_address: str | None
    requested_delivery_date: date | None
    delivery_window: str | None
    time_of_arrival: datetime | None
    shipped_at: datetime | None
    delivered_at: datetime | None
    # Who confirmed delivery: buyer | auto | legacy (None while undelivered).
    delivery_confirmed_by: str | None


class AdminOrderDetail(AdminOrderSummary):
    items: list[dict[str, Any]]
    notes: str | None
    transactions: list[AdminOrderTransaction]
    shipment: AdminOrderShipment | None
    delivery: AdminOrderDelivery

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

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
    refund_method: str | None = None
    refund_reference: str | None = None
    refunded_at: datetime | None = None


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


RefundMethod = Literal["paymongo", "gcash", "maya", "bank_transfer", "cash"]


class RecordRefundPayload(BaseModel):
    method: RefundMethod
    reference: str = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)


class AdminRefund(BaseModel):
    transaction_id: int
    order_id: int
    order_status: str
    status: str
    amount: int
    paymongo_payment_id: str | None
    paid_at: datetime | None
    buyer_name: str | None
    buyer_email: str | None
    buyer_phone: str | None
    merchant_name: str | None
    refund_method: str | None
    refund_reference: str | None
    refund_notes: str | None
    refunded_at: datetime | None

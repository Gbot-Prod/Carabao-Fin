from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

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
    # ORDER_PROOF_PHOTOS_PLAN.md: a drop-off or failed drop-off photo has a
    # flag; the buyer disputes the delivery and no admin decided yet.
    delivery_flagged: bool = False
    dispute_open: bool = False


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
    time_of_arrival: datetime | None
    shipped_at: datetime | None
    delivered_at: datetime | None
    # Who confirmed delivery: buyer | auto | merchant (drop-off photo) | legacy
    # (None while undelivered).
    delivery_confirmed_by: str | None
    # Why it was cancelled, as the buyer was told; None otherwise.
    cancel_reason: str | None = None
    # A merchant-set delivery (ORDER_PROOF_PHOTOS_PLAN.md).
    delivery_buyer_confirmed_at: datetime | None = None
    dispute_until: datetime | None = None
    delivery_disputed_at: datetime | None = None
    dispute_resolution: str | None = None
    dispute_resolved_at: datetime | None = None
    # The farm's side of the dispute.
    dispute_merchant_note: str | None = None
    dispute_merchant_noted_at: datetime | None = None


class AdminProofPhoto(BaseModel):
    """One proof photo; GET /admin/orders/{id}/proof/{kind} serves the image."""

    kind: str
    received_at: datetime
    # Metres from the phone to the buyer pin; None without GPS (and packing).
    distance_m: int | None
    flags: list[str]
    # The retention sweep deleted the image; the record stays.
    deleted: bool


class AdminOrderDetail(AdminOrderSummary):
    items: list[dict[str, Any]]
    notes: str | None
    transactions: list[AdminOrderTransaction]
    shipment: AdminOrderShipment | None
    delivery: AdminOrderDelivery
    proof_photos: list[AdminProofPhoto] = []


class CancelOrderPayload(BaseModel):
    """CF-0045: why an admin cancels the order; shown to the buyer."""

    model_config = {"extra": "forbid"}

    reason: str = Field(min_length=3, max_length=300)


class DisputeDecisionPayload(BaseModel):
    """The admin decision on a disputed merchant-set delivery."""

    model_config = ConfigDict(extra="forbid")

    decision: Literal["release", "refund"]
    note: str | None = Field(default=None, max_length=500)


RefundMethod = Literal["paymongo", "gcash", "maya", "bank_transfer", "cash"]


class RecordRefundPayload(BaseModel):
    method: RefundMethod
    reference: str = Field(min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=1000)

    model_config = ConfigDict(extra="forbid")  # CF-0063


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
    # A refund sent through PayMongo: processing | unknown | failed (None:
    # not sent, or done). can_send_paymongo: the "Refund via PayMongo" button.
    paymongo_refund_id: str | None = None
    paymongo_refund_status: str | None = None
    refund_failure_reason: str | None = None
    can_send_paymongo: bool = False


class AdminDispute(BaseModel):
    """One disputed merchant-set delivery (GET /admin/disputes)."""

    order_id: int
    order_ref: str
    order_status: str
    total_price: int
    buyer_name: str | None
    buyer_email: str | None
    merchant_id: int | None
    merchant_name: str | None
    delivered_at: datetime | None
    disputed_at: datetime
    merchant_note: str | None
    merchant_noted_at: datetime | None
    # A drop-off or failed drop-off photo has a flag.
    delivery_flagged: bool
    resolution: str | None
    resolved_at: datetime | None

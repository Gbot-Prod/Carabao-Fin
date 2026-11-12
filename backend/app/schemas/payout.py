from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, model_validator

from app.models.statuses import (
    OrderStatus,
    PaymentStatus,
    PayoutStatus,
    TransactionStatus,
)


class MerchantOrderResponse(BaseModel):
    id: int
    status: OrderStatus
    payment_status: PaymentStatus
    total_price: int
    items: list[Any]
    delivery_address: str | None = None
    ordered_at: datetime
    buyer_name: str | None = None
    buyer_email: str | None = None
    buyer_phone: str | None = None
    shipped: bool = False
    time_of_arrival: datetime | None = None
    shipment_id: int | None = None
    shipped_at: datetime | None = None
    auto_confirm_at: datetime | None = None
    # What the buyer asked for at checkout; NULL on orders placed before it.
    requested_delivery_date: date | None = None
    delivery_window: str | None = None
    notes: str | None = None

    model_config = {"from_attributes": True}


class PayoutInfoResponse(BaseModel):
    id: int
    merchant_id: int
    payout_type: str
    bank_code: str | None = None
    account_number: str | None = None
    account_name: str | None = None
    ewallet_number: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PayoutInfoUpdate(BaseModel):
    payout_type: Literal["bank", "gcash", "maya"]
    bank_code: str | None = None
    account_number: str | None = None
    account_name: str | None = None
    ewallet_number: str | None = None

    @model_validator(mode="after")
    def _require_destination(self):
        if self.payout_type == "bank":
            missing = [
                key
                for key in ("bank_code", "account_number", "account_name")
                if not getattr(self, key)
            ]
            if missing:
                raise ValueError(
                    f"Missing required fields for bank payout: {', '.join(missing)}"
                )
        elif not self.ewallet_number:
            raise ValueError(
                "Missing required field for e-wallet payout: ewallet_number"
            )
        return self


class PayoutBatchResponse(BaseModel):
    id: int
    merchant_id: int
    period_date: date
    transaction_count: int
    gross_amount: int
    status: PayoutStatus
    notes: str | None = None
    released_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TransactionSummary(BaseModel):
    id: int
    order_id: int
    amount: int
    merchant_amount: int
    status: TransactionStatus
    description: str | None = None
    created_at: datetime
    paid_at: datetime | None = None
    order_status: OrderStatus | None = None

    model_config = {"from_attributes": True}

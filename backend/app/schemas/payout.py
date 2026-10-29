from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class MerchantOrderResponse(BaseModel):
    id: int
    status: str
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
    payout_type: str
    bank_code: str | None = None
    account_number: str | None = None
    account_name: str | None = None
    ewallet_number: str | None = None


class PayoutBatchResponse(BaseModel):
    id: int
    merchant_id: int
    period_date: date
    transaction_count: int
    gross_amount: int
    status: str
    notes: str | None = None
    released_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TransactionSummary(BaseModel):
    id: int
    order_id: int
    amount: int
    merchant_amount: int
    status: str
    description: str | None = None
    created_at: datetime
    paid_at: datetime | None = None
    order_status: str | None = None

    model_config = {"from_attributes": True}

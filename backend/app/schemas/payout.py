from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel


class MerchantOrderResponse(BaseModel):
    id: int
    status: str
    total_price: int
    items: list[Any]
    delivery_address: Optional[str] = None
    ordered_at: datetime
    buyer_name: Optional[str] = None
    buyer_email: Optional[str] = None
    buyer_phone: Optional[str] = None
    shipped: bool = False
    time_of_arrival: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PayoutInfoResponse(BaseModel):
    id: int
    merchant_id: int
    payout_type: str
    bank_code: Optional[str] = None
    account_number: Optional[str] = None
    account_name: Optional[str] = None
    ewallet_number: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PayoutInfoUpdate(BaseModel):
    payout_type: str
    bank_code: Optional[str] = None
    account_number: Optional[str] = None
    account_name: Optional[str] = None
    ewallet_number: Optional[str] = None


class PayoutBatchResponse(BaseModel):
    id: int
    merchant_id: int
    period_date: date
    transaction_count: int
    gross_amount: int
    status: str
    notes: Optional[str] = None
    released_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class TransactionSummary(BaseModel):
    id: int
    order_id: int
    amount: int
    merchant_amount: int
    status: str
    description: Optional[str] = None
    created_at: datetime
    paid_at: Optional[datetime] = None

    model_config = {"from_attributes": True}

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, model_validator


class CheckoutResponse(BaseModel):
    transaction_id: int
    order_id: int
    checkout_url: str
    paymongo_session_id: str
    amount: int
    status: str


class TransactionResponse(BaseModel):
    id: int
    order_id: int
    merchant_id: int
    user_id: int
    amount: int
    platform_fee: int
    merchant_amount: int
    status: str
    paymongo_session_id: Optional[str] = None
    paymongo_payment_id: Optional[str] = None
    checkout_url: Optional[str] = None
    created_at: datetime
    paid_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class PayoutBatchResponse(BaseModel):
    id: int
    merchant_id: int
    period_date: date
    transaction_count: int
    gross_amount: int
    status: str
    notes: Optional[str] = None
    created_at: datetime
    released_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class MerchantPayoutInfoCreate(BaseModel):
    payout_type: Literal["bank", "gcash", "maya"]
    bank_code: Optional[str] = None
    account_number: Optional[str] = None
    account_name: Optional[str] = None
    ewallet_number: Optional[str] = None

    @model_validator(mode="after")
    def _validate_payout_fields(self):
        if self.payout_type == "bank":
            missing = [k for k in ("bank_code", "account_number", "account_name") if not getattr(self, k)]
            if missing:
                raise ValueError(f"Missing required fields for bank payout: {', '.join(missing)}")
        else:
            if not self.ewallet_number:
                raise ValueError("Missing required field for e-wallet payout: ewallet_number")
        return self


class MerchantPayoutInfoResponse(MerchantPayoutInfoCreate):
    id: int
    merchant_id: int

    model_config = {"from_attributes": True}

from datetime import datetime

from pydantic import BaseModel

from app.models.statuses import TransactionStatus


class CheckoutResponse(BaseModel):
    transaction_id: int
    order_id: int
    checkout_url: str
    paymongo_session_id: str
    amount: int
    status: TransactionStatus


class TransactionResponse(BaseModel):
    id: int
    order_id: int
    merchant_id: int
    user_id: int
    amount: int
    platform_fee: int
    merchant_amount: int
    status: TransactionStatus
    paymongo_session_id: str | None = None
    paymongo_payment_id: str | None = None
    checkout_url: str | None = None
    created_at: datetime
    paid_at: datetime | None = None

    model_config = {"from_attributes": True}

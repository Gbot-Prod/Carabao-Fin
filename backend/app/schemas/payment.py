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


class SavedCard(BaseModel):
    id: str
    last4: str
    brand: str
    exp_month: int
    exp_year: int

    @classmethod
    def from_paymongo(cls, pm_data: dict) -> "SavedCard":
        attrs = pm_data.get("attributes", {})
        details = attrs.get("details", {})
        return cls(
            id=pm_data["id"],
            last4=str(details.get("last4", "****")),
            brand=str(details.get("brand", "unknown")).lower(),
            exp_month=int(details.get("exp_month", 0)),
            exp_year=int(details.get("exp_year", 0)),
        )


class AttachPaymentMethodRequest(BaseModel):
    payment_method_id: str

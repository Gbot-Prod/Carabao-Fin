import re
from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.models.statuses import (
    OrderStatus,
    PaymentStatus,
    PayoutStatus,
    TransactionStatus,
)
from app.services.payout_service import (
    is_valid_bic,
    is_valid_mobile,
    normalize_mobile,
    payout_info_problem,
)


class MerchantOrderResponse(BaseModel):
    id: int
    status: OrderStatus
    payment_status: PaymentStatus
    total_price: int
    delivery_fee: int = 0
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
    notes: str | None = None
    # Why it was cancelled, as the buyer was told; None otherwise.
    cancel_reason: str | None = None
    # Proof photos the order has (ORDER_PROOF_PHOTOS_PLAN.md): a packing photo
    # is needed before it ships, alone or on a route.
    packing_photo: bool = False
    dropoff_photo: bool = False
    attempt_photo: bool = False
    delivery_confirmed_by: str | None = None

    model_config = {"from_attributes": True}


class PayoutInfoResponse(BaseModel):
    id: int
    merchant_id: int
    payout_type: str
    bank_code: str | None = None
    bank_name: str | None = None
    account_number: str | None = None
    account_name: str | None = None
    ewallet_number: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def problem(self) -> str | None:
        """Why payouts can't be sent here yet (None once it is complete)."""
        return payout_info_problem(self)


class PayoutInfoUpdate(BaseModel):
    payout_type: Literal["bank", "gcash", "maya"]
    bank_code: str | None = Field(default=None, max_length=20)
    account_number: str | None = Field(default=None, max_length=40)
    account_name: str | None = Field(default=None, max_length=100)
    ewallet_number: str | None = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def _require_destination(self):
        self.account_name = (self.account_name or "").strip() or None
        if not self.account_name:
            raise ValueError("Missing required field: account_name")
        if self.payout_type == "bank":
            self.bank_code = (self.bank_code or "").strip().upper() or None
            # Passbooks print numbers with spaces or dashes; banks want digits.
            self.account_number = (
                re.sub(r"[\s-]", "", self.account_number or "") or None
            )
            missing = [
                key for key in ("bank_code", "account_number") if not getattr(self, key)
            ]
            if missing:
                raise ValueError(
                    f"Missing required fields for bank payout: {', '.join(missing)}"
                )
            if not is_valid_bic(self.bank_code):
                raise ValueError("bank_code must be a bank from the PayMongo list")
            if not re.fullmatch(r"\d{6,20}", self.account_number):
                raise ValueError("account_number must be 6 to 20 digits")
            self.ewallet_number = None
        else:
            self.ewallet_number = normalize_mobile(self.ewallet_number)
            if not self.ewallet_number:
                raise ValueError(
                    "Missing required field for e-wallet payout: ewallet_number"
                )
            if not is_valid_mobile(self.ewallet_number):
                raise ValueError(
                    "ewallet_number must be a mobile number like 09171234567"
                )
            self.bank_code = None
            self.account_number = None
        return self

    model_config = ConfigDict(extra="forbid")  # CF-0063


class PayoutInfoChange(PayoutInfoUpdate):
    """A payout method plus the SMS code sent for exactly it (CF-0004)."""

    code: str = Field(min_length=1, max_length=12)


class PayoutCodeSent(BaseModel):
    sent_to: str  # last 4 digits of the number the code went to


class ReceivingInstitution(BaseModel):
    code: str
    name: str


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
    transfer_fee: int | None = None
    net_amount: int | None = None
    attempts: int = 0
    failure_reason: str | None = None
    provider_reference: str | None = None
    paymongo_transfer_id: str | None = None
    sent_at: datetime | None = None
    destination_type: str | None = None
    destination_name: str | None = None
    destination_number: str | None = None
    transfer_provider: Literal["instapay", "pesonet"] | None = None

    model_config = {"from_attributes": True}


class PayoutDestinationPreview(BaseModel):
    """Where a batch would go if sent now (the merchant's current method)."""

    type: str
    institution: str | None = None
    name: str | None = None
    number: str | None = None
    provider: Literal["instapay", "pesonet"] | None = None
    problem: str | None = None


class AdminPayoutBatchResponse(PayoutBatchResponse):
    merchant_name: str | None = None
    destination: PayoutDestinationPreview | None = None


class WalletBalance(BaseModel):
    """The PayMongo wallet payouts are sent from, in pesos (2 decimals)."""

    available: float
    pending: float


class AvailablePayout(BaseModel):
    transaction_count: int
    gross_amount: int
    transfer_fee: int
    net_amount: int


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


class AdminPayoutSummary(BaseModel):
    """Totals over every payout batch, whatever the table's filter."""

    waiting: int  # requested, approved or failed: an admin has to send it
    owed: int  # pesos the merchants still get (every batch not released)
    released: int  # pesos sent, all time


class AdminPayoutBatchPage(BaseModel):
    items: list[AdminPayoutBatchResponse]
    total: int
    page: int
    page_size: int
    summary: AdminPayoutSummary

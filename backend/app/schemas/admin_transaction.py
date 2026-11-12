from datetime import datetime

from pydantic import BaseModel

from app.models.statuses import TransactionStatus
from app.schemas.pagination import Page


class AdminTransactionRow(BaseModel):
    id: int
    order_id: int
    status: TransactionStatus
    amount: int
    platform_fee: int
    merchant_amount: int
    description: str | None
    paymongo_session_id: str | None
    paymongo_payment_id: str | None
    created_at: datetime
    paid_at: datetime | None
    merchant_id: int
    merchant_name: str | None
    buyer_id: int
    buyer_name: str | None
    buyer_email: str | None
    refund_method: str | None
    refund_reference: str | None
    refunded_at: datetime | None


class AdminTransactionTotals(BaseModel):
    """Sums over every transaction matching the filters, not just this page."""

    count: int
    amount: int
    platform_fee: int
    merchant_amount: int


class AdminTransactionPage(Page[AdminTransactionRow]):
    totals: AdminTransactionTotals

"""Every status value the database may hold, and the derived payment status.

These are the single source of truth: the columns are typed with them (a CHECK
constraint in the database, and SQLAlchemy rejects unknown strings before they
are sent), the API schemas validate against them, and the frontend mirrors them
in ``util/api/statuses.ts``. Members are ``str`` subclasses, so comparing a
column or attribute to a plain string keeps working.
"""

from enum import StrEnum

from sqlalchemy import Enum as SAEnum


class OrderStatus(StrEnum):
    """Where the order is in its lifecycle (``orders.status``)."""

    PENDING = "pending"  # placed, stock held, awaiting payment
    PROCESSING = "processing"  # paid; the merchant is preparing it
    SHIPPED = "shipped"
    OUT_FOR_DELIVERY = "out_for_delivery"
    DELIVERED = "delivered"
    CANCELLED = "cancelled"


class TransactionStatus(StrEnum):
    """One checkout attempt's money (``transactions.status``)."""

    PENDING = "pending"  # checkout session open
    PAID = "paid"
    FAILED = "failed"
    EXPIRED = "expired"
    REFUND_PENDING = "refund_pending"  # paid, but the order was cancelled/closed
    REFUNDED = "refunded"


class PaymentStatus(StrEnum):
    """An order's payment state, derived from its transactions. Never stored."""

    AWAITING_PAYMENT = "awaiting_payment"
    PAID = "paid"
    REFUND_PENDING = "refund_pending"
    REFUNDED = "refunded"
    UNPAID = "unpaid"  # closed without a payment ever landing


class PayoutStatus(StrEnum):
    """A merchant payout batch (``payout_batches.status``)."""

    PENDING = "pending"
    APPROVED = "approved"
    PROCESSING = "processing"
    RELEASED = "released"
    FAILED = "failed"


def status_type(enum_cls: type[StrEnum], name: str) -> SAEnum:
    """A VARCHAR column restricted to ``enum_cls``'s values by a named CHECK."""
    return SAEnum(
        enum_cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
        length=32,
    )


# Batches the admin has yet to release or fail; one at a time per merchant.
OPEN_PAYOUT_STATUSES = frozenset(
    {PayoutStatus.PENDING, PayoutStatus.APPROVED, PayoutStatus.PROCESSING}
)

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
    # A payment landed whose amount or currency is not the order's (CF-0005).
    # Not paid: its money is flagged refund_pending and an admin is alerted.
    PAYMENT_MISMATCH = "payment_mismatch"


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


class MerchantVerificationStatus(StrEnum):
    """Whether a merchant may sell (``merchants.verification_status``).

    A merchant row exists from the first onboarding step, so the seller can use
    the Merchant Centre at once. Only ``verified`` may sell: publish the shop,
    list produce publicly, take orders and request payouts
    (services/merchant_verification.py). Follows the application status; set
    only by ``sync_verification_status``.
    """

    SETUP = "setup"  # Submit later: business information not sent yet
    UNDER_REVIEW = "under_review"  # submitted, an admin has yet to decide
    NEEDS_CHANGES = "needs_changes"  # clarification requested or rejected
    VERIFIED = "verified"  # approved by an admin
    SUSPENDED = "suspended"  # suspended by an admin


class ProduceStatus(StrEnum):
    """Where a listing is in moderation (``produces.status``, guardrails Phase 1).

    "Publish now, check always": a listing with no flags is ``live`` at once.
    A listing the checker flags is ``under_review``: buyers still see it and
    can order it, and an admin approves or rejects it. A ``rejected`` listing
    is not shown; the merchant sees the reason, edits it and sends it again.
    ``hidden`` follows ``hidden_at`` (an admin removed a listing).
    """

    LIVE = "live"
    UNDER_REVIEW = "under_review"
    REJECTED = "rejected"
    HIDDEN = "hidden"


# Listings buyers see and can order (with hidden_at NULL and not expired).
BUYER_VISIBLE_PRODUCE_STATUSES = frozenset(
    {ProduceStatus.LIVE, ProduceStatus.UNDER_REVIEW}
)


# merchant_applications.status -> merchants.verification_status.
APPLICATION_TO_VERIFICATION: dict[str, MerchantVerificationStatus] = {
    "pending_documents": MerchantVerificationStatus.SETUP,
    "submitted": MerchantVerificationStatus.UNDER_REVIEW,
    "clarification": MerchantVerificationStatus.NEEDS_CHANGES,
    "rejected": MerchantVerificationStatus.NEEDS_CHANGES,
    "approved": MerchantVerificationStatus.VERIFIED,
    "suspended": MerchantVerificationStatus.SUSPENDED,
}


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

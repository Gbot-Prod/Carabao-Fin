from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.statuses import TransactionStatus, status_type


class Transaction(Base):
    __tablename__ = "transactions"
    # CF-0009; the migration is c5e9a2d7f4b1.
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        # Migration a7c9e1b3d5f8.
        CheckConstraint(
            "paymongo_refund_status IS NULL OR "
            "paymongo_refund_status IN ('processing', 'unknown', 'failed')",
            name="ck_transactions_paymongo_refund_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    merchant_id = Column(
        Integer, ForeignKey("merchants.id"), nullable=False, index=True
    )
    # The buyer. NULL after the buyer deleted their account: the payment
    # record is kept, the person is not (CF-0041; migration b9e4c7a2d5f1).
    user_id = Column(
        Integer,
        ForeignKey(
            "backend_users.id", ondelete="SET NULL", name="fk_transactions_user_id"
        ),
        nullable=True,
        index=True,
    )

    amount = Column(Integer, nullable=False)  # pesos
    platform_fee = Column(Integer, nullable=False)  # 2% of amount, can be changed
    # Typed (CF-0089): payout totals add these as ints.
    merchant_amount: Mapped[int] = mapped_column(
        Integer, nullable=False
    )  # amount - platform_fee

    status = Column(
        status_type(TransactionStatus, "ck_transactions_status"),
        nullable=False,
        default=TransactionStatus.PENDING,
        index=True,
    )

    description = Column(String, nullable=True)
    paymongo_session_id = Column(String, nullable=True, unique=True, index=True)
    paymongo_payment_id = Column(String, nullable=True)
    checkout_url = Column(String, nullable=True)

    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    paid_at = Column(DateTime(timezone=True), nullable=True)

    # Set when an admin records the refund of a refund_pending payment (A2).
    refund_method = Column(String, nullable=True)
    refund_reference = Column(String, nullable=True)
    refunded_at = Column(DateTime(timezone=True), nullable=True)
    refunded_by = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    refund_notes = Column(Text, nullable=True)
    # A refund sent through the PayMongo Refunds API (refund_service). It stays
    # refund_pending until PayMongo says it succeeded. Status: processing (sent),
    # unknown (timeout: check the PayMongo dashboard), failed (safe to resend).
    paymongo_refund_id = Column(String, nullable=True, unique=True, index=True)
    paymongo_refund_status = Column(String(16), nullable=True)
    refund_failure_reason = Column(Text, nullable=True)

    order = relationship("Order", back_populates="transactions")
    merchant = relationship("Merchant")
    user = relationship("User", foreign_keys=[user_id])
    payout_items = relationship("PayoutBatchItem", back_populates="transaction")

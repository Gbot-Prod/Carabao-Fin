from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.statuses import TransactionStatus, status_type


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    merchant_id = Column(
        Integer, ForeignKey("merchants.id"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("backend_users.id"), nullable=False, index=True
    )

    amount = Column(Integer, nullable=False)  # pesos
    platform_fee = Column(Integer, nullable=False)  # 2% of amount, can be changed
    merchant_amount = Column(Integer, nullable=False)  # amount - platform_fee

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

    order = relationship("Order", back_populates="transactions")
    merchant = relationship("Merchant")
    user = relationship("User", foreign_keys=[user_id])
    payout_items = relationship("PayoutBatchItem", back_populates="transaction")

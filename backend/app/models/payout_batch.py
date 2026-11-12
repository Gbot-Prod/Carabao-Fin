from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.statuses import PayoutStatus, status_type


class PayoutBatch(Base):
    __tablename__ = "payout_batches"

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(
        Integer, ForeignKey("merchants.id"), nullable=False, index=True
    )
    period_date = Column(Date, nullable=False, index=True)
    transaction_count = Column(Integer, nullable=False, default=0)
    gross_amount = Column(Integer, nullable=False, default=0)  # pesos
    status = Column(
        status_type(PayoutStatus, "ck_payout_batches_status"),
        nullable=False,
        default=PayoutStatus.PENDING,
        index=True,
    )
    notes = Column(Text, nullable=True)
    released_at = Column(DateTime(timezone=True), nullable=True)

    # The PayMongo transfer. gross_amount is what the merchant earned; the
    # transfer fee comes out of it, so net_amount is what actually lands.
    transfer_fee = Column(Integer, nullable=True)  # pesos
    net_amount = Column(Integer, nullable=True)  # pesos
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    # Our reference for the latest attempt; webhooks are matched on it too.
    paymongo_reference = Column(String, nullable=True, unique=True, index=True)
    paymongo_transfer_id = Column(String, nullable=True, unique=True, index=True)
    provider_reference = Column(String, nullable=True)  # trace number on the rail
    failure_reason = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    # Where the money went, copied at send time so later edits don't rewrite history.
    destination_type = Column(String, nullable=True)
    destination_bic = Column(String, nullable=True)
    destination_name = Column(String, nullable=True)
    destination_number = Column(String, nullable=True)
    transfer_provider = Column(String, nullable=True)  # instapay | pesonet
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    merchant = relationship("Merchant")
    items = relationship("PayoutBatchItem", back_populates="batch")


class PayoutBatchItem(Base):
    __tablename__ = "payout_batch_items"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(
        Integer, ForeignKey("payout_batches.id"), nullable=False, index=True
    )
    transaction_id = Column(
        Integer, ForeignKey("transactions.id"), nullable=False, unique=True
    )
    amount = Column(Integer, nullable=False)  # merchant_amount from transaction

    batch = relationship("PayoutBatch", back_populates="items")
    transaction = relationship("Transaction", back_populates="payout_items")

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class PayoutBatch(Base):
    __tablename__ = "payout_batches"

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=False, index=True)
    period_date = Column(Date, nullable=False, index=True)
    transaction_count = Column(Integer, nullable=False, default=0)
    gross_amount = Column(Integer, nullable=False, default=0)  # pesos
    status = Column(String, nullable=False, default="pending", index=True)
    # pending | approved | processing | released | failed
    notes = Column(Text, nullable=True)
    released_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    merchant = relationship("Merchant")
    items = relationship("PayoutBatchItem", back_populates="batch")


class PayoutBatchItem(Base):
    __tablename__ = "payout_batch_items"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("payout_batches.id"), nullable=False, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"), nullable=False, unique=True)
    amount = Column(Integer, nullable=False)  # merchant_amount from transaction

    batch = relationship("PayoutBatch", back_populates="items")
    transaction = relationship("Transaction", back_populates="payout_items")

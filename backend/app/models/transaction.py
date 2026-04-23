from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, index=True)
    merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("backend_users.id"), nullable=False, index=True)

    amount = Column(Integer, nullable=False)           # pesos
    platform_fee = Column(Integer, nullable=False)     # 1% of amount
    merchant_amount = Column(Integer, nullable=False)  # 99% of amount

    status = Column(String, nullable=False, default="pending", index=True)
    # pending | paid | failed | expired

    description = Column(String, nullable=True)
    paymongo_session_id = Column(String, nullable=True, unique=True, index=True)
    paymongo_payment_id = Column(String, nullable=True)
    checkout_url = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    paid_at = Column(DateTime(timezone=True), nullable=True)

    order = relationship("Order")
    merchant = relationship("Merchant")
    user = relationship("User")
    payout_items = relationship("PayoutBatchItem", back_populates="transaction")

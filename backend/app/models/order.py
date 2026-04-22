from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Order(Base):
	__tablename__ = "orders"

	id = Column(Integer, primary_key=True, index=True)
	order_history_id = Column(Integer, ForeignKey("order_histories.id"), nullable=False, index=True)
	merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=True, index=True)
	status = Column(String, nullable=False, index=True, default="pending")
	total_price = Column(Integer, nullable=False, default=0)
	items = Column(JSON, nullable=False, default=list)
	ordered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

	order_history = relationship("OrderHistory", back_populates="orders")
	merchant = relationship("Merchant", back_populates="orders")
	current_order = relationship("CurrentOrder", back_populates="order", uselist=False, cascade="all, delete-orphan")

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class CurrentOrder(Base):
	__tablename__ = "current_orders"

	id = Column(Integer, primary_key=True, index=True)
	order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, unique=True, index=True)
	merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=True, index=True)
	merchant_name = Column(String, nullable=False, index=True)
	status = Column(String, nullable=False, default="pending", index=True)
	shipped = Column(Boolean, nullable=False, default=False)
	time_of_arrival = Column(DateTime(timezone=True), nullable=True)
	delivery_fee = Column(Integer, nullable=False, default=0)
	image = Column(String, nullable=True)
	created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

	order = relationship("Order", back_populates="current_order")
	merchant = relationship("Merchant", back_populates="current_orders")

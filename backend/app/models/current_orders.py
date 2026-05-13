from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class CurrentOrder(Base):
	__tablename__ = "current_orders"

	id = Column(Integer, primary_key=True, index=True)
	order_id = Column(Integer, ForeignKey("orders.id"), nullable=False, unique=True, index=True)
	merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=True, index=True)
	status = Column(String, nullable=False, default="pending", index=True)
	time_of_arrival = Column(DateTime(timezone=True), nullable=True)
	delivery_fee = Column(Integer, nullable=False, default=0)
	image = Column(String, nullable=True)
	created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

	order = relationship("Order", back_populates="current_order")
	merchant = relationship("Merchant", back_populates="current_orders")

	@property
	def shipped(self) -> bool:
		return self.status.lower() in {"shipped", "out_for_delivery", "delivered"}

	@property
	def merchant_name(self) -> str:
		if self.merchant is not None:
			return self.merchant.merchant_name
		if self.order is not None:
			for item in (self.order.items or []):
				if isinstance(item, dict):
					name = item.get("farm") or item.get("merchant")
					if name:
						return str(name)
		return f"Order #{self.order_id}"

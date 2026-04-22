from sqlalchemy import Column, DateTime, ForeignKey, Integer
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class OrderHistory(Base):
	__tablename__ = "order_histories"

	id = Column(Integer, primary_key=True, index=True)
	user_id = Column(Integer, ForeignKey("backend_users.id"), nullable=False, unique=True, index=True)
	total_orders = Column(Integer, nullable=False, default=0)
	total_spent = Column(Integer, nullable=False, default=0)
	last_order_at = Column(DateTime(timezone=True), nullable=True)
	created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
	updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

	user = relationship("User", back_populates="order_history")
	orders = relationship("Order", back_populates="order_history", cascade="all, delete-orphan")

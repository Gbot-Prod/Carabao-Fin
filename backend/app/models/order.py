from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    order_history_id = Column(
        Integer, ForeignKey("order_histories.id"), nullable=False, index=True
    )
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=True, index=True)
    status = Column(String, nullable=False, index=True, default="pending")
    total_price = Column(Integer, nullable=False, default=0)
    items = Column(JSON, nullable=False, default=list)
    delivery_address = Column(String, nullable=True)
    ordered_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    shipment_id = Column(Integer, ForeignKey("shipments.id"), nullable=True, index=True)
    shipped_at = Column(DateTime(timezone=True), nullable=True, index=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    delivery_confirmed_by = Column(String, nullable=True)  # buyer | auto | legacy
    # Pre-computed ALNS route stored when marked for shipping
    route_waypoints = Column(JSONB, nullable=True)

    order_history = relationship("OrderHistory", back_populates="orders")
    user = relationship("User")
    merchant = relationship("Merchant", back_populates="orders")
    shipment = relationship("Shipment", back_populates="orders")
    current_order = relationship(
        "CurrentOrder",
        back_populates="order",
        uselist=False,
        cascade="all, delete-orphan",
    )

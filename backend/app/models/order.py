from sqlalchemy import (
    JSON,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.statuses import OrderStatus, status_type


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
    status = Column(
        status_type(OrderStatus, "ck_orders_status"),
        nullable=False,
        index=True,
        default=OrderStatus.PENDING,
    )
    total_price = Column(Integer, nullable=False, default=0)
    items = Column(JSON, nullable=False, default=list)
    delivery_address = Column(String, nullable=True)
    # Map pin for the delivery address (U1).
    delivery_lat = Column(Float, nullable=True)
    delivery_lng = Column(Float, nullable=True)
    # What the buyer asked for at checkout; the route ETA is time_of_arrival.
    requested_delivery_date = Column(Date, nullable=True, index=True)
    delivery_window = Column(String, nullable=True)  # e.g. "08:00 – 10:00"
    notes = Column(Text, nullable=True)
    ordered_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    shipment_id = Column(Integer, ForeignKey("shipments.id"), nullable=True, index=True)
    shipped_at = Column(DateTime(timezone=True), nullable=True, index=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    delivery_confirmed_by = Column(String, nullable=True)  # buyer | auto | legacy
    # Pre-computed ALNS route stored when marked for shipping
    route_waypoints = Column(JSONB, nullable=True)
    # ETA from the optimised delivery route
    time_of_arrival = Column(DateTime(timezone=True), nullable=True)
    delivery_fee = Column(Integer, nullable=False, default=0, server_default="0")
    image = Column(String, nullable=True)

    order_history = relationship("OrderHistory", back_populates="orders")
    user = relationship("User")
    merchant = relationship("Merchant", back_populates="orders")
    shipment = relationship("Shipment", back_populates="orders")
    # Every checkout attempt; read through payment_status(), not directly.
    transactions = relationship(
        "Transaction", back_populates="order", order_by="Transaction.created_at"
    )

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.statuses import OrderStatus, status_type


class Order(Base):
    __tablename__ = "orders"
    # CF-0009; the migration is c5e9a2d7f4b1.
    __table_args__ = (
        CheckConstraint("total_price >= 0", name="ck_orders_total_not_negative"),
        CheckConstraint(
            "dispute_resolution IS NULL OR dispute_resolution IN ('release', 'refund')",
            name="ck_orders_dispute_resolution",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
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
    # The nearest road point to the pin; routing and the rider use it.
    delivery_road_lat = Column(Float, nullable=True)
    delivery_road_lng = Column(Float, nullable=True)
    # True once the person placed or moved the pin themselves; false while it
    # is only where the typed address geocoded to (approximate).
    delivery_pin_confirmed = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # A rider reported that the pin could not be reached (pin quality, control 6).
    pin_unreachable_at = Column(DateTime(timezone=True), nullable=True)
    pin_unreachable_note = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    ordered_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    shipment_id = Column(Integer, ForeignKey("shipments.id"), nullable=True, index=True)
    shipped_at = Column(DateTime(timezone=True), nullable=True, index=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    # buyer | auto | merchant (drop-off photo) | legacy
    delivery_confirmed_by = Column(String, nullable=True)
    # A merchant-set delivery: the buyer tapped "Confirm received" after it,
    # which ends the payout hold at once.
    delivery_buyer_confirmed_at = Column(DateTime(timezone=True), nullable=True)
    # The buyer said "I did not get this" during the hold; payout is frozen
    # until an admin decides (dispute_resolution: release | refund).
    delivery_disputed_at = Column(DateTime(timezone=True), nullable=True)
    dispute_resolution = Column(String(16), nullable=True)
    dispute_resolved_at = Column(DateTime(timezone=True), nullable=True)
    dispute_resolved_by = Column(
        Integer,
        ForeignKey(
            "backend_users.id",
            ondelete="SET NULL",
            name="fk_orders_dispute_resolved_by",
        ),
        nullable=True,
    )
    # The farm's side of a disputed delivery, for the admin who decides it.
    dispute_merchant_note = Column(Text, nullable=True)
    dispute_merchant_noted_at = Column(DateTime(timezone=True), nullable=True)
    # When the order became delivered, cancelled or payment_mismatch. The
    # retention sweep starts its clock here (CF-0044; migration d2a6f8c4e1b7).
    closed_at = Column(DateTime(timezone=True), nullable=True, index=True)
    # Why the order was cancelled, as the buyer is told (farm, admin or sweep).
    cancel_reason = Column(String(400), nullable=True)
    # When the retention sweep removed the delivery details and chat.
    details_purged_at = Column(DateTime(timezone=True), nullable=True)
    # Pre-computed ALNS route stored when marked for shipping
    route_waypoints = Column(JSONB, nullable=True)
    # ETA from the optimised delivery route
    time_of_arrival = Column(DateTime(timezone=True), nullable=True)
    delivery_fee = Column(Integer, nullable=False, default=0, server_default="0")
    # CF-0070 (B10): the buyer removed it from their history. The row stays
    # for the farm, admins, payments and reviews; only the buyer's lists skip it.
    hidden_by_buyer_at = Column(DateTime(timezone=True), nullable=True)
    image = Column(String, nullable=True)

    user = relationship("User", foreign_keys=[user_id])
    merchant = relationship("Merchant", back_populates="orders")
    shipment = relationship("Shipment", back_populates="orders")
    # Every checkout attempt; read through payment_status(), not directly.
    transactions = relationship(
        "Transaction", back_populates="order", order_by="Transaction.created_at"
    )

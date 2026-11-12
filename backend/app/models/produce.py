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
from sqlalchemy.orm import relationship

from app.core.database import Base


class Produce(Base):
    __tablename__ = "produces"

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(
        Integer, ForeignKey("merchants.id"), nullable=False, index=True
    )
    name = Column(String, nullable=False, index=True)
    description = Column(String, nullable=True)
    category = Column(String, nullable=True, index=True)
    price = Column(Integer, nullable=False, default=0)  # pesos
    unit = Column(String, nullable=False, default="kg")
    unit_quantity = Column(Float, nullable=False, default=1.0)
    stock_quantity = Column(Integer, nullable=False, default=0)
    image_url = Column(String, nullable=True)
    # NULL on listings created before these were collected.
    harvest_date = Column(Date, nullable=True)
    best_before = Column(Date, nullable=True, index=True)
    # In sale units (see unit_quantity), the same count a buyer puts in the cart.
    min_order_qty = Column(Integer, nullable=False, default=1)
    # [{"min_qty": int, "unit_price": int}], lowest min_qty first; see
    # services/produce_pricing.py.
    price_tiers = Column(JSON, nullable=False, default=list)
    # Set when an admin hides the listing (A6): buyers can't see or order it and
    # the merchant sees the reason. Only an admin can unhide it.
    hidden_at = Column(DateTime(timezone=True), nullable=True, index=True)
    hidden_reason = Column(Text, nullable=True)
    hidden_by = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )

    merchant = relationship("Merchant", back_populates="produces")

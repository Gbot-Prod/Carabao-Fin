from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
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
from app.models.statuses import ProduceStatus, status_type


class Produce(Base):
    __tablename__ = "produces"
    # CF-0009; the migration is c5e9a2d7f4b1.
    __table_args__ = (
        CheckConstraint("price > 0", name="ck_produces_price_positive"),
        CheckConstraint(
            "stock_quantity >= 0", name="ck_produces_stock_not_negative"
        ),
    )

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

    # Guardrails Phase 1 (services/listing_checks.py; migration d8e2f4a6b1c3).
    status = Column(
        status_type(ProduceStatus, "ck_produces_status"),
        nullable=False,
        index=True,
        default=ProduceStatus.LIVE,
        server_default=ProduceStatus.LIVE.value,
    )
    # The soft flags of the last check: [{"field", "code", "message"}].
    review_flags = Column(JSON, nullable=False, default=list)
    # When the listing last went to under_review (the admin queue is oldest first).
    submitted_for_review_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    # Phase 2: the first approval only (never cleared). A new merchant's
    # listings go to review until listing_trust.NEW_MERCHANT_REVIEW_COUNT have it.
    approved_at = Column(DateTime(timezone=True), nullable=True)
    reviewed_by = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    # Set on reject (one of listing_checks.REJECTION_CODES) with the text the
    # merchant sees; cleared when the merchant sends the listing again.
    rejection_code = Column(String(40), nullable=True)
    rejection_reason = Column(Text, nullable=True)

    # Guardrails Phase 4 (migration e9a1c3b5d7f2). The 64-bit pHash of the
    # photo (services/photo_checks.py), for the stolen-photo flag.
    image_phash = Column(BigInteger, nullable=True)
    # The last vision check of the photo (services/listing_vision.py):
    # {"key", "model", "checked_at", "shows_named_produce", "detected_produce",
    #  "has_contact_text", "note", "cleared"}. NULL: not checked.
    photo_check = Column(JSON, nullable=True)

    merchant = relationship("Merchant", back_populates="produces")

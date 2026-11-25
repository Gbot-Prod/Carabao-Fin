"""A photo that proves one step of an order (ORDER_PROOF_PHOTOS_PLAN.md).

``packing``: the farm packed the order (needed before it ships).
``dropoff``: the rider delivered it (the merchant sets ``delivered``).
``attempt``: the rider was at the address and the buyer was not (a cancel
from ``out_for_delivery``).

The photo is in the private R2 bucket (``object_key``). The retention sweep
deletes the object 90 days after the order closes and keeps the row: the hash,
the time, the distance and the flags. No raw GPS position is stored.
"""

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base

PROOF_KINDS = ("packing", "dropoff", "attempt")


class OrderProofPhoto(Base):
    __tablename__ = "order_proof_photos"
    __table_args__ = (
        UniqueConstraint("order_id", "kind", name="uq_order_proof_photos_order_kind"),
        CheckConstraint(
            "kind IN ('packing', 'dropoff', 'attempt')",
            name="ck_order_proof_photos_kind",
        ),
    )

    id = Column(Integer, primary_key=True)
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind = Column(String(16), nullable=False)
    # NULL once the retention sweep deleted the object (deleted_at is set).
    object_key = Column(String, nullable=True)
    # SHA-256 of the bytes the phone sent; the same hash on two orders is a flag.
    sha256 = Column(String(64), nullable=False, index=True)
    content_type = Column(String(32), nullable=False)
    taken_by_user_id = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    received_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Metres from the phone to the buyer pin; NULL without GPS (and for packing).
    distance_m = Column(Integer, nullable=True)
    # gps_far | gps_missing | pin_missing | hash_reused | pin_reported
    flags = Column(JSON, nullable=False, default=list)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

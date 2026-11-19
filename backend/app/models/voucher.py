"""Merchant voucher codes and their use at checkout (CF-0058, B05 slice 1).

A voucher belongs to one farm and lowers the produce subtotal of that farm's
order. The farm pays for the discount: the order total (what the buyer pays
and what the payout is built from) is already lower. Platform-wide vouchers
need a decision on who pays for them and are not here.
"""

from sqlalchemy import (
    Boolean,
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

VOUCHER_KINDS = ("percent", "fixed")


class Voucher(Base):
    __tablename__ = "vouchers"
    __table_args__ = (
        UniqueConstraint("merchant_id", "code", name="uq_vouchers_merchant_code"),
        CheckConstraint("kind IN ('percent', 'fixed')", name="ck_vouchers_kind"),
        # percent: 1–90 (never a free order); fixed: pesos off, at least 1.
        CheckConstraint(
            "(kind = 'percent' AND value BETWEEN 1 AND 90) "
            "OR (kind = 'fixed' AND value >= 1)",
            name="ck_vouchers_value",
        ),
        CheckConstraint("min_subtotal >= 0", name="ck_vouchers_min_subtotal"),
        CheckConstraint(
            "max_discount IS NULL OR max_discount >= 1",
            name="ck_vouchers_max_discount",
        ),
        CheckConstraint(
            "usage_limit IS NULL OR usage_limit >= 1", name="ck_vouchers_usage_limit"
        ),
        CheckConstraint("per_user_limit >= 1", name="ck_vouchers_per_user_limit"),
    )

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(
        Integer,
        ForeignKey("merchants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Upper case A–Z, 0–9 and "-", 3–32 characters (services/vouchers.py).
    code = Column(String(32), nullable=False)
    kind = Column(String(16), nullable=False)
    value = Column(Integer, nullable=False)
    # Pesos of produce (not delivery) the farm's order must reach.
    min_subtotal = Column(Integer, nullable=False, default=0, server_default="0")
    # Cap on a percent discount, in pesos. None: no cap.
    max_discount = Column(Integer, nullable=True)
    # Uses across all buyers; None: no cap. Cancelled orders give the use back.
    usage_limit = Column(Integer, nullable=True)
    per_user_limit = Column(Integer, nullable=False, default=1, server_default="1")
    starts_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class VoucherRedemption(Base):
    """One use of a voucher: the order it lowered and by how much."""

    __tablename__ = "voucher_redemptions"
    __table_args__ = (
        UniqueConstraint("order_id", name="uq_voucher_redemptions_order"),
        CheckConstraint("discount >= 1", name="ck_voucher_redemptions_discount"),
    )

    id = Column(Integer, primary_key=True, index=True)
    voucher_id = Column(
        Integer,
        ForeignKey("vouchers.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
    )
    discount = Column(Integer, nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

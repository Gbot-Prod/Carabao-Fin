# Typed columns (CF-0089) on MerchantPayoutInfo; see payout_batch.py.
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from app.core.database import Base


class MerchantPayoutInfo(Base):
    __tablename__ = "merchant_payout_info"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    merchant_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("merchants.id"), nullable=False, unique=True, index=True
    )

    payout_type: Mapped[str] = mapped_column(
        String, nullable=False
    )  # bank | gcash | maya
    # PayMongo receiving-institution code (BIC), e.g. BNORPHMMXXX for BDO.
    bank_code: Mapped[str | None] = mapped_column(String, nullable=True)
    bank_name: Mapped[str | None] = mapped_column(String, nullable=True)
    account_number: Mapped[str | None] = mapped_column(String, nullable=True)
    account_name: Mapped[str | None] = mapped_column(String, nullable=True)
    # mobile number for GCash/Maya
    ewallet_number: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    merchant = relationship("Merchant")


class PayoutDestinationChange(Base):
    """One saved change of a merchant's payout method (CF-0004).

    Append-only. ``before`` is None for the first setup. Written in the same
    commit as the change, after the SMS code was checked.
    """

    __tablename__ = "payout_destination_changes"

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(
        Integer, ForeignKey("merchants.id"), nullable=False, index=True
    )
    user_id = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    before = Column(JSON, nullable=True)
    after = Column(JSON, nullable=False)
    # Last 4 digits of the number the confirming code was sent to.
    confirmed_via = Column(String(16), nullable=True)
    ip_address = Column(String(64), nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

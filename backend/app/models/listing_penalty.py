from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, func

from app.core.database import Base


class ListingPenalty(Base):
    """Penalty points for one confirmed listing violation (guardrails Phase 2).

    An admin rejection with a reason in ``listing_trust.PENALTY_POINTS`` adds a
    row. Points count for ``listing_trust.PENALTY_WINDOW_DAYS`` days after
    ``created_at``. An admin can revoke a row (an appeal); a revoked row counts
    no points but stays for the history.
    """

    __tablename__ = "listing_penalties"
    __table_args__ = (
        Index("ix_listing_penalties_merchant_created", "merchant_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(
        Integer, ForeignKey("merchants.id", ondelete="CASCADE"), nullable=False
    )
    # The listing can be deleted later; produce_name keeps what it was.
    produce_id = Column(
        Integer, ForeignKey("produces.id", ondelete="SET NULL"), nullable=True
    )
    produce_name = Column(String, nullable=False)
    # One of listing_checks.REJECTION_CODES.
    code = Column(String(40), nullable=False)
    points = Column(Integer, nullable=False)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_by = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoked_by = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    revoke_reason = Column(Text, nullable=True)

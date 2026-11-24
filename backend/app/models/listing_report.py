from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)

from app.core.database import Base


class ListingReport(Base):
    """A buyer's report on one listing (guardrails Phase 3).

    An open report (``resolved_at`` NULL) puts the listing in the admin review
    queue (services/listing_reports.py). An admin decision on the listing
    (approve, reject or hide) closes every open report on it. One open report
    per buyer and listing.
    """

    __tablename__ = "listing_reports"
    __table_args__ = (
        Index(
            "uq_listing_reports_open",
            "produce_id",
            "reporter_id",
            unique=True,
            postgresql_where=text("resolved_at IS NULL"),
            sqlite_where=text("resolved_at IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    produce_id = Column(
        Integer,
        ForeignKey("produces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reporter_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    reason = Column(String(40), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    # approved | rejected | hidden: what the admin did with the listing.
    resolution = Column(String(16), nullable=True)

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)

from app.core.database import Base


class ProhibitedTerm(Base):
    """A word or phrase the listing checker looks for (guardrails Phase 1).

    Admins add, change and turn off rows without a deploy (routes/admin_terms.py).
    The first rows come from documentation/manuals/carabao_produce_guardrail_wordlist.md
    through ``scripts/load_prohibited_terms.py``.
    """

    __tablename__ = "prohibited_terms"
    __table_args__ = (
        Index("ix_prohibited_terms_active_category", "is_active", "category"),
        UniqueConstraint("term", name="uq_prohibited_terms_term"),
    )

    id = Column(Integer, primary_key=True, index=True)
    # Lower case, single spaces (listing_checks.normalize_term).
    term = Column(String(120), nullable=False)
    # contact | prohibited_commodity | profanity | spam
    category = Column(String(50), nullable=False)
    # hard_block | soft_flag
    severity = Column(String(20), nullable=False, default="hard_block")
    # en | tl | ceb | all
    language = Column(String(10), nullable=False, default="all")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

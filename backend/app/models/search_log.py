from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.sql import func

from app.core.database import Base


class SearchLog(Base):
    """One buyer produce search (U2), kept for demand insight (F3). No user id."""

    __tablename__ = "search_logs"

    id = Column(Integer, primary_key=True, index=True)
    query = Column(String(100), nullable=False, index=True)  # lowercased, trimmed
    province = Column(String, nullable=True, index=True)
    result_count = Column(Integer, nullable=False, default=0)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

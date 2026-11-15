"""One-time codes and rate-limit hits, kept in Postgres (CF-0016).

Both used to live in process memory, so every API worker had its own copy: a
code sent by one worker could not be checked by another, and each worker
counted its own limits. In the database all workers share them.
"""

from sqlalchemy import BigInteger, Column, DateTime, Index, Integer, String
from sqlalchemy.sql import func

from app.core.database import Base


class OtpCode(Base):
    """The current code for one key (purpose, user and number).

    Only an HMAC of the code is stored (``services/otp.py``), never the code.
    """

    __tablename__ = "otp_codes"

    id = Column(Integer, primary_key=True)
    # e.g. "merchant:12:639171234567"
    key = Column(String(120), nullable=False, unique=True)
    code_hash = Column(String(64), nullable=False)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    sent_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RateLimitHit(Base):
    """One accepted request, counted against ``key`` for a sliding window."""

    __tablename__ = "rate_limit_hits"
    __table_args__ = (Index("ix_rate_limit_hits_key_hit_at", "key", "hit_at"),)

    # BigInteger in Postgres; SQLite (tests) only autoincrements INTEGER.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    # e.g. "otp_send:ip:203.0.113.7" or "account_otp:id:639171234567"
    key = Column(String(200), nullable=False)
    hit_at = Column(DateTime(timezone=True), nullable=False, index=True)

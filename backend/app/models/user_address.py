from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class UserAddress(Base):
    """A saved delivery address. A user has many; at most one is the default,
    which routing falls back to when an order has no address of its own."""

    __tablename__ = "user_addresses"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Optional name the buyer gives it, e.g. "Home" or "Office".
    label = Column(String, nullable=True)
    region = Column(String, nullable=True)
    province = Column(String, nullable=True)
    city = Column(String, nullable=True)
    barangay = Column(String, nullable=True)
    address = Column(String, nullable=True)
    postal_code = Column(String, nullable=True)
    # Map pin for the address (U1); routing prefers it over geocoding.
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    user = relationship("User", back_populates="addresses")

    __table_args__ = (
        # One default per user.
        Index(
            "uq_user_addresses_one_default",
            user_id,
            unique=True,
            postgresql_where=text("is_default"),
            sqlite_where=text("is_default"),
        ),
    )

    @property
    def short_line(self) -> str | None:
        """Street and city, the text geocoded when there is no pin."""
        parts = [p for p in (self.address, self.city) if p]
        return ", ".join(parts) if parts else None

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
    # Who receives deliveries here and how the rider reaches them (+639XXXXXXXXX).
    recipient_name = Column(String(100), nullable=True)
    recipient_phone = Column(String(20), nullable=True)
    region = Column(String, nullable=True)
    province = Column(String, nullable=True)
    city = Column(String, nullable=True)
    barangay = Column(String, nullable=True)
    # PSGC codes of the four levels above (services/psgc.py). province_code is
    # empty for NCR (Metro Manila has no province in the PSGC).
    region_code = Column(String(10), nullable=True)
    province_code = Column(String(10), nullable=True)
    city_code = Column(String(10), nullable=True, index=True)
    barangay_code = Column(String(10), nullable=True)
    address = Column(String, nullable=True)
    postal_code = Column(String, nullable=True)
    # Map pin for the address (U1); routing prefers it over geocoding.
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    # The nearest road point to the pin; routing uses it.
    road_lat = Column(Float, nullable=True)
    road_lng = Column(Float, nullable=True)
    # True once the person placed or moved the pin themselves; false while it
    # is only where the typed address geocoded to (approximate).
    pin_confirmed = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # services/pin_area.py: true when the pin is outside the chosen city or
    # barangay (but near it); NULL when not checked (no pin, no area, no shape).
    pin_area_mismatch = Column(Boolean, nullable=True)
    # Set by the server only, when a delivery to this pin finished and no
    # rider reported it (services/pinned_location.py mark_pin_verified).
    # Moving the pin clears it.
    pin_verified_at = Column(DateTime(timezone=True), nullable=True)
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

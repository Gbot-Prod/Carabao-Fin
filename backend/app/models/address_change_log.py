from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.sql import func

from app.core.database import Base


class AddressChangeLog(Base):
    """One change to the pin or the area of a saved address or a shop
    (services/address_log.py). Ops use it to find pins that hop around.

    No coordinates and no address text (CF-0059: a pin is a person's home):
    only the PSGC codes before and after, and how far the pin moved.
    Rows older than ``address_log.KEEP_DAYS`` are deleted in the cleanup loop.
    """

    __tablename__ = "address_change_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # "user_address" or "merchant"; the row may be deleted later.
    target_type = Column(String(20), nullable=False)
    target_id = Column(Integer, nullable=False)
    # "create", "update" or "delete".
    action = Column(String(10), nullable=False)
    old_city_code = Column(String(10), nullable=True)
    new_city_code = Column(String(10), nullable=True)
    old_barangay_code = Column(String(10), nullable=True)
    new_barangay_code = Column(String(10), nullable=True)
    # "set" (no pin before), "moved", "cleared", or NULL (pin not changed).
    pin_change = Column(String(10), nullable=True)
    # Metres between the old and the new pin, for "moved" only.
    pin_moved_m = Column(Float, nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

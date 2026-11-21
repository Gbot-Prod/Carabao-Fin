from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class MerchantSetupReminder(Base):
    """One "finish your business information" reminder that was sent.

    A merchant still in ``setup`` (Submit later) is reminded on days 1, 3, 7
    and 14 after the application was created (services/setup_reminders.py).
    The row is written before the message goes out and is unique per day, so
    a reminder is never sent twice.
    """

    __tablename__ = "merchant_setup_reminders"
    __table_args__ = (
        UniqueConstraint("merchant_id", "day", name="uq_merchant_setup_reminders_day"),
    )

    id = Column(Integer, primary_key=True)
    merchant_id = Column(
        Integer,
        ForeignKey("merchants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Days after the application was created: 1, 3, 7 or 14.
    day = Column(Integer, nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

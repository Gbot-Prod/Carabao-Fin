from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from app.core.database import Base


class Notification(Base):
    """An in-app notification (U5): order placed/paid/shipped/delivered, review
    received, payout released, refund. Shown in the bell on web and mobile."""

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind = Column(String(40), nullable=False)
    # Which side of the account it is about: "buyer", "merchant" or "admin".
    # Set by services.notifications.notify from the link; the buyer site shows
    # buyer (and admin) ones, the merchant site only merchant ones.
    audience = Column(
        String(10), nullable=False, server_default="buyer", default="buyer", index=True
    )
    title = Column(String(120), nullable=False)
    body = Column(String(500), nullable=True)
    # In-app path to open, e.g. "/orders/12".
    link = Column(String(200), nullable=True)
    read_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

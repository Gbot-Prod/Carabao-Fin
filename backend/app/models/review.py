from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    SmallInteger,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Review(Base):
    """A buyer's rating of a merchant, earned by one delivered order.

    ``order_id`` is unique so each order yields at most one review, which keeps
    ratings tied to verified purchases. The order and reviewer FKs are SET NULL
    so a review (and the merchant's aggregate) survives the buyer removing the
    order from their history or closing their account.
    """

    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    merchant_id = Column(
        Integer,
        ForeignKey("merchants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    rating = Column(SmallInteger, nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint("rating BETWEEN 1 AND 5", name="ck_reviews_rating_range"),
    )

    user = relationship("User")
    merchant = relationship("Merchant", back_populates="reviews")

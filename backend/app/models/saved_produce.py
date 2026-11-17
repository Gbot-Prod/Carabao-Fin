from sqlalchemy import Column, DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class SavedProduce(Base):
    """A produce listing a buyer saved for later (wishlist, CF-0038).

    Rows are kept while a listing is hidden or out of season, so it comes
    back to the buyer's list when it is listed again. Deleting the buyer or
    the listing deletes the row.
    """

    __tablename__ = "saved_produce"
    __table_args__ = (
        UniqueConstraint(
            "user_id", "produce_id", name="uq_saved_produce_user_produce"
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    produce_id = Column(
        Integer,
        ForeignKey("produces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

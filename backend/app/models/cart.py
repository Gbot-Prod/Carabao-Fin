from sqlalchemy import JSON, Column, ForeignKey, Integer
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.services import money


class Cart(Base):
    __tablename__ = "carts"

    id = Column(Integer, primary_key=True, index=True)
    # Goes with the account (also when its BetterAuth user is deleted).
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    items = Column(JSON, nullable=False, default=list)

    user = relationship("User", back_populates="cart")

    @property
    def total_items(self) -> int:
        return sum(
            max(int(i.get("quantity", 0)), 0)
            for i in (self.items or [])
            if isinstance(i, dict)
        )

    @property
    def total_price(self) -> int:  # pesos
        # The server writes every line's price; a bad one raises (CF-0014).
        return sum(
            money.line_total(i.get("price"), i.get("quantity"))
            for i in (self.items or [])
            if isinstance(i, dict)
        )

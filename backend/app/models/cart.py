from sqlalchemy import Column, ForeignKey, Integer, JSON
from sqlalchemy.orm import relationship

from app.core.database import Base


class Cart(Base):
    __tablename__ = "carts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("backend_users.id"), nullable=False, unique=True, index=True)
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
        return sum(
            max(int(i.get("quantity", 0)), 0) * max(int(float(i.get("price", 0))), 0)
            for i in (self.items or [])
            if isinstance(i, dict)
        )

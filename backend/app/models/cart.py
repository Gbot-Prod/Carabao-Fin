from sqlalchemy import Column, ForeignKey, Integer, JSON
from sqlalchemy.orm import relationship

from app.core.database import Base


class Cart(Base):
    __tablename__ = "carts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("backend_users.id"), nullable=False, unique=True, index=True)
    items = Column(JSON, nullable=False, default=list)
    total_items = Column(Integer, nullable=False, default=0)
    total_price = Column(Integer, nullable=False, default=0)

    user = relationship("User", back_populates="cart")

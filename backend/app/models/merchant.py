from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class Merchant(Base):
    __tablename__ = "merchants"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    merchant_name = Column(String, nullable=False, index=True)
    location = Column(String, nullable=True, index=True)
    contact_number = Column(String, unique=True, index=True)
    operating_hours = Column(String, nullable=True, index=True)
    delivery_time = Column(Integer, nullable=True, index=True)
    delivery_price = Column(Integer, nullable=True, index=True)
    rating = Column(Integer, nullable=True, index=True)

    user = relationship("User", back_populates="merchant")
    shop_page = relationship("ShopPage", back_populates="merchant", uselist=False, cascade="all, delete-orphan")

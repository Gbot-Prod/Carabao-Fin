from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class Produce(Base):
    __tablename__ = "produces"

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=False, index=True)
    name = Column(String, nullable=False, index=True)
    description = Column(String, nullable=True)
    category = Column(String, nullable=True, index=True)
    price = Column(Integer, nullable=False, default=0)
    unit = Column(String, nullable=False, default="kg")
    stock_quantity = Column(Integer, nullable=False, default=0)
    image_url = Column(String, nullable=True)

    merchant = relationship("Merchant", back_populates="produces")

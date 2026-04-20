from sqlalchemy import Boolean, Column, Integer, String, ForeignKey
from app.core.database import Base

class Merchant(Base):
  __tablename__ = "merchants"

  id = Column(Integer, primary_key=True, index=True)
  user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
  merchant_name = Column(String, index=True)
  location = Column(String, index=True)
  contact_number = Column(String, unique=True, index=True)
  operating_hours = Column(String, index=True)
  delivery_time = Column(Integer, index=True)
  delivery_price = Column(Integer, index=True)
  rating = Column(Integer, index=True)

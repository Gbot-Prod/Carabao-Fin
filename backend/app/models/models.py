from sqlalchemy import Boolean, Column, Integer, String, ForeignKey
from database import Base

class User(Base):
  __tablename__ = "users"

  id = Column(Integer, primary_key=True, index=True)
  clerkId = Column(String, unique=True, index=True, nullable=True)
  first_name = Column(String, index=True, nullable=True)
  last_name = Column(String, index=True, nullable=True)
  email = Column(String, unique=True, index=True, nullable=False)
  created_at = Column(String, index=True, nullable=True)
  phone_number = Column(String, unique=True, index=True, nullable=True )

class Merchant(Base):
  __tablename__ = "merchants"

  id = Column(Integer, primary_key=True, index=True)
  merchant_name = Column(String, index=True)
  location = Column(String, index=True)
  contact_number = Column(String, unique=True, index=True)
  operating_hours = Column(String, index=True)
  delivery_time = Column(Integer, index=True)
  delivery_price = Column(Integer, index=True)
  rating = Column(Integer, index=True)



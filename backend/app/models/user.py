from sqlalchemy import Boolean, Column, Integer, String, ForeignKey
from backend.app.core.database import Base

class User(Base):
  __tablename__ = "users"

  id = Column(Integer, primary_key=True, index=True)
  clerkId = Column(String, unique=True, index=True, nullable=True)
  first_name = Column(String, index=True, nullable=True)
  last_name = Column(String, index=True, nullable=True)
  email = Column(String, unique=True, index=True, nullable=False)
  created_at = Column(String, index=True, nullable=True)
  phone_number = Column(String, unique=True, index=True, nullable=True )
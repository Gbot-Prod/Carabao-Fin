from sqlalchemy import Boolean, Column, Integer, String, ForeignKey
from database import Base

class User(Base):
  __tablename__ = "users"

  id = Column(Integer, primary_key=True, index=True)
  first_name = Column(String, index=True)
  last_name = Column(String, index=True)
  phone_number = Column(String, unique=True, index=True, nullable=False )
  email = Column(String, unique=True, index=True, nullable=False)
  password_hash = Column(String(255), nullable=False)

from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    external_auth_id = Column(String, unique=True, index=True, nullable=True)
    first_name = Column(String, index=True, nullable=True)
    last_name = Column(String, index=True, nullable=True)
    email = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(String, index=True, nullable=True)
    phone_number = Column(String, unique=True, index=True, nullable=True)

    merchant = relationship("Merchant", back_populates="user", uselist=False, cascade="all, delete-orphan")
    cart = relationship("Cart", back_populates="user", uselist=False, cascade="all, delete-orphan")
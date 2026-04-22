from sqlalchemy import Boolean, Column, DateTime, Integer, JSON, String
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class User(Base):
    __tablename__ = "backend_users"

    id = Column(Integer, primary_key=True, index=True)
    external_auth_id = Column(String, unique=True, index=True, nullable=True)
    first_name = Column(String, index=True, nullable=True)
    last_name = Column(String, index=True, nullable=True)
    email = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    phone_number = Column(String, unique=True, index=True, nullable=True)
    address = Column(String, index=True, nullable=True)
    city = Column(String, index=True, nullable=True)
    country = Column(String, index=True, nullable=True)
    postal_code = Column(String, index=True, nullable=True)
    member_since = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    notifications_preferences = Column(JSON, nullable=False, default=dict)

    is_admin = Column(Boolean, nullable=False, default=False)

    merchant = relationship("Merchant", back_populates="user", uselist=False, cascade="all, delete-orphan")
    cart = relationship("Cart", back_populates="user", uselist=False, cascade="all, delete-orphan")
    order_history = relationship("OrderHistory", back_populates="user", uselist=False, cascade="all, delete-orphan")
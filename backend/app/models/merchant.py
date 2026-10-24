from sqlalchemy import Column, Float, Integer, JSON, String, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class Merchant(Base):
    __tablename__ = "merchants"

    id = Column(Integer, primary_key=True, index=True)
    merchant_name = Column(String, nullable=False, index=True)
    contact_number = Column(String, unique=True, index=True)
    operating_hours = Column(JSON, nullable=True)
    delivery_time = Column(Integer, nullable=True, index=True)
    delivery_price = Column(Integer, nullable=True, index=True)  # pesos
    rating = Column(Float, nullable=True, index=True)

    user_id = Column(Integer, ForeignKey("backend_users.id"), index=True, nullable=False, unique=True)
    address = Column(String, ForeignKey("backend_users.address"), index=True, nullable=True)
    barangay = Column(String, ForeignKey("backend_users.barangay"), index=True, nullable=True)
    city = Column(String, ForeignKey("backend_users.city"), index=True, nullable=True)
    province = Column(String, ForeignKey("backend_users.province"), index=True, nullable=True)
    region = Column(String, ForeignKey("backend_users.region"), index=True, nullable=True)
    postal_code = Column(String, ForeignKey("backend_users.postal_code"), index=True, nullable=True)

    user = relationship("User", back_populates="merchant")
    shop_page = relationship("ShopPage", back_populates="merchant", uselist=False, cascade="all, delete-orphan")
    produces = relationship("Produce", back_populates="merchant", cascade="all, delete-orphan")
    orders = relationship("Order", back_populates="merchant")
    current_orders = relationship("CurrentOrder", back_populates="merchant")

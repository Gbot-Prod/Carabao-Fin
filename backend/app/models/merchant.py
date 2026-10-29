from sqlalchemy import JSON, Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Merchant(Base):
    __tablename__ = "merchants"

    # Basic information
    id = Column(Integer, primary_key=True, index=True)
    merchant_name = Column(String, nullable=False, index=True)
    contact_number = Column(String, unique=True, index=True)
    rating = Column(Float, nullable=True, index=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    # Set when the merchant closes their account. The row is kept so its
    # orders, transactions and payouts stay attributable.
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    # Location / availability / price range
    region = Column(String, nullable=False, index=True)
    province = Column(String, nullable=False, index=True)
    city = Column(String, nullable=True, index=True)
    barangay = Column(String, nullable=True, index=True)
    address = Column(String, nullable=False, index=True)
    postal_code = Column(String, nullable=False, index=True)

    available_days = Column(JSON, nullable=False, default=list)
    operating_hours = Column(JSON, nullable=False)
    delivery_time = Column(Integer, nullable=True, index=True)

    delivery_price = Column(Integer, nullable=True, index=True)  # pesos
    price_range_min = Column(Integer, nullable=False)
    price_range_max = Column(Integer, nullable=False)

    # Legal details
    legal_business_name = Column(String, nullable=True)
    business_type = Column(String, nullable=False)
    tin = Column(String, nullable=True)
    registration_type = Column(String, nullable=True)
    registration_number = Column(String, nullable=True)
    contact_email = Column(String, nullable=True, index=True)
    rsbsa_number = Column(String, nullable=True)
    rsbsa_document_path = Column(String, nullable=False)
    rsbsa_document_original_name = Column(String, nullable=True)
    rsbsa_document_content_type = Column(String, nullable=True)

    # i dont fucking know
    user_id = Column(
        Integer, ForeignKey("backend_users.id"), index=True, nullable=False, unique=True
    )

    user = relationship("User", back_populates="merchant")
    shop_page = relationship(
        "ShopPage",
        back_populates="merchant",
        uselist=False,
        cascade="all, delete-orphan",
    )
    produces = relationship(
        "Produce", back_populates="merchant", cascade="all, delete-orphan"
    )
    orders = relationship("Order", back_populates="merchant")
    current_orders = relationship("CurrentOrder", back_populates="merchant")

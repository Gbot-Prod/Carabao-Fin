from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.sql import func

from app.core.database import Base


class MerchantApplication(Base):
    __tablename__ = "merchant_applications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("backend_users.id"), nullable=False, unique=True, index=True)

    # Lifecycle
    status = Column(String, nullable=False, default="submitted", index=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Step 1: Legal details
    merchant_name = Column(String, nullable=False)
    legal_business_name = Column(String, nullable=False)
    business_type = Column(String, nullable=False)
    tin = Column(String, nullable=True)
    registration_type = Column(String, nullable=True)
    registration_number = Column(String, nullable=True)
    contact_email = Column(String, nullable=False, index=True)
    contact_number = Column(String, nullable=False, index=True)

    # Step 2: Location / availability / price range
    address_line = Column(String, nullable=False)
    city = Column(String, nullable=False)
    province = Column(String, nullable=False)
    region = Column(String, nullable=True)
    postal_code = Column(String, nullable=True)
    price_range_min = Column(Integer, nullable=False)
    price_range_max = Column(Integer, nullable=False)
    available_days = Column(JSON, nullable=False, default=list)

    # Step 3: RSBSA document
    rsbsa_number = Column(String, nullable=True)
    rsbsa_document_path = Column(String, nullable=False)
    rsbsa_document_original_name = Column(String, nullable=True)
    rsbsa_document_content_type = Column(String, nullable=True)


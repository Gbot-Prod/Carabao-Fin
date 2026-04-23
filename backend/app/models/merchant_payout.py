from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class MerchantPayoutInfo(Base):
    __tablename__ = "merchant_payout_info"

    id = Column(Integer, primary_key=True, index=True)
    merchant_id = Column(Integer, ForeignKey("merchants.id"), nullable=False, unique=True, index=True)

    payout_type = Column(String, nullable=False)   # bank | gcash | maya
    bank_code = Column(String, nullable=True)      # BDO, BPI, etc.
    account_number = Column(String, nullable=True)
    account_name = Column(String, nullable=True)
    ewallet_number = Column(String, nullable=True)  # mobile number for GCash/Maya

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    merchant = relationship("Merchant")

from __future__ import annotations

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import validates
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.field_crypto import EncryptedString, blind_index


class MerchantApplication(Base):
    __tablename__ = "merchant_applications"
    # One application per TIN / RSBSA number (CF-0028). NULLs do not clash.
    __table_args__ = tuple(
        Index(
            f"uq_merchant_applications_{column}",
            column,
            unique=True,
            postgresql_where=text(f"{column} IS NOT NULL"),
            sqlite_where=text(f"{column} IS NOT NULL"),
        )
        for column in ("tin_hmac", "rsbsa_number_hmac")
    )

    id = Column(Integer, primary_key=True, index=True)
    # Goes with the account (also when its BetterAuth user is deleted).
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    merchant_id = Column(
        Integer,
        ForeignKey("merchants.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Lifecycle
    status = Column(String, nullable=False, default="submitted", index=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Legal details
    merchant_name = Column(String, nullable=False)
    legal_business_name = Column(String, nullable=True)
    business_type = Column(String, nullable=False)
    # Encrypted at rest (CF-0007); tin_hmac is for lookups and duplicates.
    tin = Column(EncryptedString("tin"), nullable=True)
    tin_hmac = Column(String(64), nullable=True, index=True)
    registration_type = Column(String, nullable=True)
    registration_number = Column(String, nullable=True)
    contact_email = Column(String, nullable=False, index=True)
    contact_number = Column(String, nullable=False, index=True)
    rsbsa_number = Column(EncryptedString("rsbsa_number"), nullable=True)
    rsbsa_number_hmac = Column(String(64), nullable=True, index=True)
    rsbsa_document_path = Column(String, nullable=False)
    rsbsa_document_original_name = Column(String, nullable=True)
    rsbsa_document_content_type = Column(String, nullable=True)

    # Step 2: Location / availability
    region = Column(String, nullable=False)
    province = Column(String, nullable=False)
    city = Column(String, nullable=False)
    barangay = Column(String, nullable=True)
    address = Column(String, nullable=False)
    postal_code = Column(String, nullable=False)
    # Map pin (U1).
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    available_days = Column(JSON, nullable=False, default=list)

    # Admin review
    admin_note = Column(String, nullable=True)

    @validates("tin")
    def _set_tin_hmac(self, _key: str, value: str | None) -> str | None:
        value = value or None
        self.tin_hmac = blind_index(value)
        return value

    @validates("rsbsa_number")
    def _set_rsbsa_number_hmac(self, _key: str, value: str | None) -> str | None:
        value = value or None
        self.rsbsa_number_hmac = blind_index(value)
        return value

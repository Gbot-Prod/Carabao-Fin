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
    ) + (
        # Duplicate lookups for the automated document checks. Not unique: a
        # duplicate only raises a flag for the admin.
        Index("ix_merchant_applications_gov_id_number_hmac", "gov_id_number_hmac"),
        Index(
            "ix_merchant_applications_ocr_rsbsa_number_hmac", "ocr_rsbsa_number_hmac"
        ),
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
    # Any valid government ID (onboarding section 2), private bucket.
    gov_id_type = Column(String, nullable=False)
    gov_id_document_path = Column(String, nullable=False)
    gov_id_document_original_name = Column(String, nullable=True)
    gov_id_document_content_type = Column(String, nullable=True)

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
    # The nearest road point to the pin; routing uses it.
    road_lat = Column(Float, nullable=True)
    road_lng = Column(Float, nullable=True)
    available_days = Column(JSON, nullable=False, default=list)

    # Admin review
    admin_note = Column(String, nullable=True)
    # The admin who made the last decision, and when.
    reviewed_by_user_id = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at = Column(DateTime(timezone=True), nullable=True)

    # Automated document checks (app/services/document_checks.py). They only
    # collect data and raise flags; an admin makes every decision. The OCR
    # text itself is not stored. Numbers are kept as blind indexes (HMAC).
    gov_id_number_hmac = Column(String(64), nullable=True)
    ocr_rsbsa_number_hmac = Column(String(64), nullable=True)
    gov_id_file_sha256 = Column(String(64), nullable=True, index=True)
    rsbsa_file_sha256 = Column(String(64), nullable=True, index=True)
    ocr_gov_id_name = Column(EncryptedString("ocr_gov_id_name"), nullable=True)
    ocr_rsbsa_number = Column(EncryptedString("rsbsa_number"), nullable=True)
    name_match_score = Column(Float, nullable=True)
    check_flags = Column(JSON, nullable=True)
    check_status = Column(String, nullable=True, index=True)  # pending|completed|failed
    checked_at = Column(DateTime(timezone=True), nullable=True)

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

from __future__ import annotations

from sqlalchemy import (
    JSON,
    Boolean,
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

    # Business information. A pending_documents application ("Submit later")
    # has only seller_type here; the rest is filled in when it is submitted.
    merchant_name = Column(String, nullable=True)
    # individual_farmer | sole_proprietor | corporation | cooperative
    # (schemas/merchant_application.py SellerType).
    seller_type = Column(String, nullable=True, index=True)
    # Computed by the server: company_name, or "First Middle Last Suffix".
    legal_business_name = Column(String, nullable=True)
    # The individual's legal name (individual_farmer, sole_proprietor).
    last_name = Column(String(80), nullable=True)
    first_name = Column(String(80), nullable=True)
    middle_name = Column(String(80), nullable=True)
    suffix = Column(String(10), nullable=True)
    # male | female, and the ISO birth date (encrypted), as on the government
    # ID. Individual seller types only; the admin uses them in the DA RSBSA
    # Finder.
    sex = Column(String(10), nullable=True)
    birth_date = Column(EncryptedString("birth_date"), nullable=True)
    # A corporation's authorized representative (their government ID).
    rep_last_name = Column(String(80), nullable=True)
    rep_first_name = Column(String(80), nullable=True)
    rep_middle_name = Column(String(80), nullable=True)
    rep_suffix = Column(String(10), nullable=True)
    # Registered company / cooperative name, and the business or trade name.
    company_name = Column(String(255), nullable=True)
    trade_name = Column(String(255), nullable=True)
    # Encrypted at rest (CF-0007); tin_hmac is for lookups and duplicates.
    tin = Column(EncryptedString("tin"), nullable=True)
    tin_hmac = Column(String(64), nullable=True, index=True)
    # Derived from seller_type (DTI, SEC, CDA; none for an individual farmer).
    registration_type = Column(String, nullable=True)
    registration_number = Column(String, nullable=True)
    # vat_registered | non_vat (registered seller types).
    vat_status = Column(String(20), nullable=True)
    # BIR Certificate of Registration (Form 2303), private bucket.
    bir_cert_document_path = Column(String, nullable=True)
    bir_cert_document_original_name = Column(String, nullable=True)
    bir_cert_document_content_type = Column(String, nullable=True)
    # Small agricultural producer declaration (BIR RR No. 12-2023), for
    # individual_farmer and sole_proprietor only; NULL for other types.
    # TODO: ask declared sellers to confirm again each year
    # (small_agri_declared_year); no reminder is built yet.
    small_agri_producer = Column(Boolean, nullable=True)
    small_agri_declared_at = Column(DateTime(timezone=True), nullable=True)
    small_agri_declared_year = Column(Integer, nullable=True)
    # The Terms and Data Privacy checkbox on the final submit.
    terms_accepted_at = Column(DateTime(timezone=True), nullable=True)
    terms_version = Column(String(40), nullable=True)
    contact_email = Column(String, nullable=False, index=True)
    contact_number = Column(String, nullable=False, index=True)
    rsbsa_number = Column(EncryptedString("rsbsa_number"), nullable=True)
    rsbsa_number_hmac = Column(String(64), nullable=True, index=True)
    rsbsa_document_path = Column(String, nullable=True)
    rsbsa_document_original_name = Column(String, nullable=True)
    rsbsa_document_content_type = Column(String, nullable=True)
    # Any valid government ID (onboarding section 2), private bucket.
    gov_id_type = Column(String, nullable=True)
    gov_id_document_path = Column(String, nullable=True)
    gov_id_document_original_name = Column(String, nullable=True)
    gov_id_document_content_type = Column(String, nullable=True)
    # Selfie with ID: a camera photo of the applicant holding the government
    # ID (onboarding section 2), private bucket. The admin compares the faces.
    selfie_document_path = Column(String, nullable=True)
    selfie_document_original_name = Column(String, nullable=True)
    selfie_document_content_type = Column(String, nullable=True)

    # Step 2: Location / availability
    region = Column(String, nullable=False)
    province = Column(String, nullable=False)
    city = Column(String, nullable=False)
    barangay = Column(String, nullable=True)
    # PSGC codes of the four levels above (services/psgc.py). province_code is
    # empty for NCR (Metro Manila has no province in the PSGC).
    region_code = Column(String(10), nullable=True)
    province_code = Column(String(10), nullable=True)
    city_code = Column(String(10), nullable=True, index=True)
    barangay_code = Column(String(10), nullable=True)
    address = Column(String, nullable=False)
    postal_code = Column(String, nullable=False)
    # Map pin (U1).
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    # The nearest road point to the pin; routing uses it.
    road_lat = Column(Float, nullable=True)
    road_lng = Column(Float, nullable=True)
    # True once the person placed or moved the pin themselves; false while it
    # is only where the typed address geocoded to (approximate).
    pin_confirmed = Column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    # services/pin_area.py: true when the pin is outside the chosen city or
    # barangay (but near it); NULL when not checked (no pin, no area, no shape).
    pin_area_mismatch = Column(Boolean, nullable=True)
    available_days = Column(JSON, nullable=False, default=list)

    # Admin review
    admin_note = Column(String, nullable=True)
    # Set with a clarification request: the sections (CLARIFICATION_SECTIONS)
    # the applicant must change. The other sections stay as sent. NULL: none
    # flagged, so every section is open.
    clarification_sections = Column(JSON, nullable=True)
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
    # Read from the uploaded BIR Form 2303. The TIN and name are encrypted;
    # ocr_bir_tin_hmac is for duplicate lookups.
    bir_file_sha256 = Column(String(64), nullable=True, index=True)
    selfie_file_sha256 = Column(String(64), nullable=True, index=True)
    ocr_bir_tin = Column(EncryptedString("tin"), nullable=True)
    ocr_bir_tin_hmac = Column(String(64), nullable=True)
    ocr_bir_name = Column(EncryptedString("ocr_bir_name"), nullable=True)
    ocr_bir_vat_status = Column(String(20), nullable=True)
    # The review checklist built from the checks: a list of
    # {id, label, result (pass|warn|fail|not_checked), reason, document,
    # related_application_ids}. Stored so the review page does not recompute it.
    check_checklist = Column(JSON, nullable=True)
    # The items an admin ticked as reviewed: {item_id: {"by": id, "at": iso}}.
    # Approval needs every warn and fail item here (application_review.py).
    check_confirmations = Column(JSON, nullable=True)

    @validates("tin")
    def _set_tin_hmac(self, _key: str, value: str | None) -> str | None:
        value = value or None
        self.tin_hmac = blind_index(value)
        return value

    @validates("ocr_bir_tin")
    def _set_ocr_bir_tin_hmac(self, _key: str, value: str | None) -> str | None:
        value = value or None
        self.ocr_bir_tin_hmac = blind_index(value)
        return value

    @validates("rsbsa_number")
    def _set_rsbsa_number_hmac(self, _key: str, value: str | None) -> str | None:
        value = value or None
        self.rsbsa_number_hmac = blind_index(value)
        return value

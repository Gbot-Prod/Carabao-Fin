from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates
from sqlalchemy.sql import func

from app.core.database import Base
from app.core.field_crypto import EncryptedString, blind_index
from app.models.statuses import MerchantVerificationStatus, status_type


class Merchant(Base):
    __tablename__ = "merchants"
    # One live merchant per TIN / RSBSA number (CF-0028). A closed merchant
    # (deleted_at set) does not hold the number.
    __table_args__ = tuple(
        Index(
            f"uq_merchants_{column}_live",
            column,
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        )
        for column in ("tin_hmac", "rsbsa_number_hmac")
    )

    # Basic information
    # Typed (CF-0089) so `merchant.id` is an int to mypy; same DDL.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    merchant_name = Column(String, nullable=False, index=True)
    contact_number = Column(String, unique=True, index=True)
    # The number before the last change, and when it changed. Payout alerts
    # also go to it for a few days (CF-0019).
    previous_contact_number = Column(String, nullable=True)
    contact_number_changed_at = Column(DateTime(timezone=True), nullable=True)

    # Cached average of reviews.rating; recomputed by review_service.
    rating = Column(Float, nullable=True, index=True)
    rating_count = Column(Integer, nullable=False, default=0, server_default="0")
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
    # Set when an admin suspends the approved application (CF-0010). Buyers no
    # longer see the shop and it takes no new orders.
    suspended_at = Column(DateTime(timezone=True), nullable=True, index=True)
    # Whether the merchant may sell (statuses.MerchantVerificationStatus). The
    # row exists from the first onboarding step; only "verified" sells. Written
    # only by services/merchant_verification.sync_verification_status.
    verification_status = Column(
        status_type(MerchantVerificationStatus, "ck_merchants_verification_status"),
        nullable=False,
        index=True,
        default=MerchantVerificationStatus.SETUP,
        server_default=MerchantVerificationStatus.SETUP.value,
    )

    # Location / availability
    region = Column(String, nullable=False, index=True)
    province = Column(String, nullable=False, index=True)
    city = Column(String, nullable=True, index=True)
    barangay = Column(String, nullable=True, index=True)
    # PSGC codes of the four levels above (services/psgc.py). province_code is
    # empty for NCR (Metro Manila has no province in the PSGC).
    region_code = Column(String(10), nullable=True)
    province_code = Column(String(10), nullable=True)
    city_code = Column(String(10), nullable=True, index=True)
    barangay_code = Column(String(10), nullable=True)
    address = Column(String, nullable=False, index=True)
    postal_code = Column(String, nullable=False, index=True)

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
    operating_hours = Column(JSON, nullable=False)
    delivery_time = Column(Integer, nullable=True, index=True)

    delivery_price = Column(Integer, nullable=True, index=True)  # pesos

    # F1: listings at or below this stock are flagged on the dashboard (0 = off).
    low_stock_threshold = Column(Integer, nullable=False, default=5, server_default="5")

    # CF-0066 (B13): holiday mode. While today (Manila) is on or before
    # paused_until the farm stays listed but takes no orders. It ends by
    # itself the day after; no job has to clear it.
    paused_until = Column(Date, nullable=True)
    pause_message = Column(String(200), nullable=True)

    # Legal details
    legal_business_name = Column(String, nullable=True)
    # Copied from the application (merchant_applications.seller_type); the
    # reviewed tax and document fields below are copied at approval, so they
    # are NULL on a merchant that is not verified yet.
    seller_type = Column(String, nullable=True)
    vat_status = Column(String(20), nullable=True)
    # BIR RR No. 12-2023 declaration; receipts for a declared seller say they
    # are not BIR invoices (services/receipts.py).
    small_agri_producer = Column(Boolean, nullable=True)
    small_agri_declared_year = Column(Integer, nullable=True)
    # Encrypted at rest (CF-0007); tin_hmac is for lookups and duplicates.
    tin = Column(EncryptedString("tin"), nullable=True)
    tin_hmac = Column(String(64), nullable=True, index=True)
    registration_type = Column(String, nullable=True)
    registration_number = Column(String, nullable=True)
    contact_email = Column(String, nullable=True, index=True)
    rsbsa_number = Column(EncryptedString("rsbsa_number"), nullable=True)
    rsbsa_number_hmac = Column(String(64), nullable=True, index=True)
    rsbsa_document_path = Column(String, nullable=True)
    rsbsa_document_original_name = Column(String, nullable=True)
    rsbsa_document_content_type = Column(String, nullable=True)
    # Copied from the approved application (R2 keys, not the files).
    gov_id_type = Column(String, nullable=True)
    gov_id_document_path = Column(String, nullable=True)
    gov_id_document_original_name = Column(String, nullable=True)
    gov_id_document_content_type = Column(String, nullable=True)
    # BIR Form 2303 (registered seller types), R2 key and metadata.
    bir_cert_document_path = Column(String, nullable=True)
    bir_cert_document_original_name = Column(String, nullable=True)
    bir_cert_document_content_type = Column(String, nullable=True)
    # Selfie with ID, R2 key and metadata.
    selfie_document_path = Column(String, nullable=True)
    selfie_document_original_name = Column(String, nullable=True)
    selfie_document_content_type = Column(String, nullable=True)
    # The admin who approved the application, and when.
    verified_by_user_id = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    verified_at = Column(DateTime(timezone=True), nullable=True)

    # i dont fucking know
    user_id = Column(
        Integer, ForeignKey("backend_users.id"), index=True, nullable=False, unique=True
    )

    user = relationship("User", back_populates="merchant", foreign_keys=[user_id])
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
    reviews = relationship("Review", back_populates="merchant", passive_deletes=True)

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

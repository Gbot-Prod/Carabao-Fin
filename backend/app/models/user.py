from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.user_address import UserAddress


def normalize_email(value: str) -> str:
    """Canonical form for storing and comparing emails (matches Better Auth)."""
    return value.strip().lower()


def split_name(full_name: str | None) -> tuple[str | None, str | None]:
    """(first, rest) for services that want two name fields, e.g. PayMongo."""
    parts = (full_name or "").split()
    if not parts:
        return None, None
    return parts[0], " ".join(parts[1:]) or None


class User(Base):
    __tablename__ = "backend_users"

    id = Column(Integer, primary_key=True, index=True)
    external_auth_id = Column(String, unique=True, index=True, nullable=True)
    # Full name as one field, the same shape as BetterAuth's "user".name (kept
    # in step by PATCH /users/me).
    name = Column(String, index=True, nullable=True)
    # Stored normalized (normalize_email); also unique case-insensitively via
    # ix_backend_users_email_lower below (migration b7e3c1d9a420).
    email = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    phone_number = Column(String, unique=True, index=True, nullable=True)
    notifications_preferences = Column(JSON, nullable=False, default=dict)

    profile_picture_url = Column(String, nullable=True)
    paymongo_customer_id = Column(String, unique=True, index=True, nullable=True)
    is_admin = Column(Boolean, nullable=False, default=False)
    # Not a column: BetterAuth's "user"."twoFactorEnabled", read live by
    # better_auth_store.load_two_factor (for admins in get_current_user, E8c).
    two_factor_enabled = False
    # Set by an admin (A3). A suspended user can't sign in or call the API, and
    # a suspended merchant's shop and listings are hidden from buyers.
    suspended_at = Column(DateTime(timezone=True), nullable=True, index=True)
    suspension_reason = Column(Text, nullable=True)
    suspended_by = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )

    merchant = relationship(
        "Merchant", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    cart = relationship(
        "Cart", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    # Saved delivery addresses (user_addresses), default first.
    addresses = relationship(
        UserAddress,
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by=(UserAddress.is_default.desc(), UserAddress.id.asc()),
    )

    @property
    def default_address(self) -> UserAddress | None:
        """The default saved address, else the oldest one, else None."""
        return next((a for a in self.addresses if a.is_default), None) or (
            self.addresses[0] if self.addresses else None
        )

    __table_args__ = (
        Index("ix_backend_users_email_lower", func.lower(email), unique=True),
    )

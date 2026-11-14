from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Integer,
    String,
    and_,
    case,
    exists,
    select,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base
from app.models.auth_identity import (
    PLACEHOLDER_EMAIL_DOMAIN,
    AuthIdentity,
    is_placeholder_email,
)
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


def _identity_column(column):
    """Correlated subquery for one BetterAuth column, for use in filters."""
    return (
        select(column)
        .where(AuthIdentity.id == User.external_auth_id)
        .correlate_except(AuthIdentity)
        .scalar_subquery()
    )


class User(Base):
    """The backend's side of an account: profile data and the integer id the
    rest of the schema points at.

    Identity (name, email, phone, admin role, suspension, 2FA) lives only in
    BetterAuth's "user" table and is read through ``identity``; the properties
    below expose it under the names the rest of the code uses. They are
    read-only: BetterAuth's client changes name, email and phone, and the admin
    routes change role and suspension through better_auth_store.
    """

    __tablename__ = "backend_users"

    id = Column(Integer, primary_key=True, index=True)
    # BetterAuth "user".id. Set when the row is created on the first request.
    external_auth_id = Column(String, unique=True, index=True, nullable=True)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    notifications_preferences = Column(JSON, nullable=False, default=dict)

    profile_picture_url = Column(String, nullable=True)

    identity = relationship(
        AuthIdentity,
        primaryjoin=lambda: User.external_auth_id == AuthIdentity.id,
        foreign_keys=lambda: [User.external_auth_id],
        viewonly=True,
        uselist=False,
        # A second SELECT ... WHERE id IN (...), not a join: an outer join would
        # break SELECT ... FOR UPDATE on users in Postgres.
        lazy="selectin",
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

    # ── Identity, read from BetterAuth ────────────────────────────────────

    @hybrid_property
    def name(self) -> str | None:
        return (self.identity.name or "").strip() or None if self.identity else None

    @name.inplace.expression
    @classmethod
    def _name_expression(cls):
        return _identity_column(AuthIdentity.name)

    @hybrid_property
    def email(self) -> str | None:
        """The account email, or None for a phone signup that hasn't added one.

        May be unverified; use ``verified_email`` before sending anything to it.
        """
        if self.identity is None or is_placeholder_email(self.identity.email):
            return None
        return self.identity.email

    @email.inplace.expression
    @classmethod
    def _email_expression(cls):
        # NULL for a placeholder, like the Python side, so filters agree with
        # what's shown (a search for "639" mustn't match every phone signup).
        return _identity_column(
            case(
                (
                    func.lower(AuthIdentity.email).like(f"%@{PLACEHOLDER_EMAIL_DOMAIN}"),
                    None,
                ),
                else_=AuthIdentity.email,
            )
        )

    @property
    def email_verified(self) -> bool:
        return self.email is not None and bool(self.identity.email_verified)

    @property
    def verified_email(self) -> str | None:
        """Where email may be sent: a real address the user has confirmed."""
        return self.email if self.email_verified else None

    @hybrid_property
    def phone_number(self) -> str | None:
        return self.identity.phone_number if self.identity else None

    @phone_number.inplace.expression
    @classmethod
    def _phone_number_expression(cls):
        return _identity_column(AuthIdentity.phone_number)

    @property
    def phone_verified(self) -> bool:
        """Checkout, merchant applications and order chat need this."""
        return bool(
            self.identity
            and self.identity.phone_number
            and self.identity.phone_number_verified
        )

    @hybrid_property
    def is_admin(self) -> bool:
        return bool(self.identity and self.identity.role == "admin")

    @is_admin.inplace.expression
    @classmethod
    def _is_admin_expression(cls):
        return exists().where(
            and_(AuthIdentity.id == cls.external_auth_id, AuthIdentity.role == "admin")
        )

    @hybrid_property
    def is_suspended(self) -> bool:
        """Banned by an admin (A3): no sign-in, no API, shop hidden from buyers."""
        return bool(self.identity and self.identity.banned)

    @is_suspended.inplace.expression
    @classmethod
    def _is_suspended_expression(cls):
        return exists().where(
            and_(
                AuthIdentity.id == cls.external_auth_id,
                AuthIdentity.banned.is_(True),
            )
        )

    @property
    def suspension_reason(self) -> str | None:
        return self.identity.ban_reason if self.is_suspended else None

    @property
    def two_factor_enabled(self) -> bool:
        return bool(self.identity and self.identity.two_factor_enabled)

"""Read-only view of BetterAuth's "user" table, the one source of identity.

BetterAuth (the Next.js app) creates and edits these rows; the backend only
reads them, through ``User.identity``. The few writes the backend still makes
(ban, role, avatar, account deletion) go through app/services/better_auth_store.py
as plain SQL, so an ORM flush that would write here is refused outright.

The table is excluded from Alembic (alembic/env.py EXCLUDED_TABLES). Tests create
it from this model on SQLite.
"""

from sqlalchemy import Boolean, Column, DateTime, String, Text, event
from sqlalchemy.orm import Session

from app.core.database import Base

# Phone signups get a made-up address because BetterAuth requires an email.
# ".invalid" is reserved (RFC 2606), so nothing can ever be delivered to it.
# Keep in step with PHONE_PLACEHOLDER_EMAIL_DOMAIN in lib/auth.ts.
PLACEHOLDER_EMAIL_DOMAIN = "phone.carabao.invalid"


def is_placeholder_email(email: str | None) -> bool:
    return bool(email) and email.strip().lower().endswith(
        "@" + PLACEHOLDER_EMAIL_DOMAIN
    )


class AuthIdentity(Base):
    __tablename__ = "user"

    id = Column(Text, primary_key=True)
    name = Column(Text, nullable=False, default="")
    email = Column(Text, nullable=False)
    email_verified = Column("emailVerified", Boolean, nullable=False, default=False)
    image = Column(Text, nullable=True)
    created_at = Column("createdAt", DateTime, nullable=True)
    updated_at = Column("updatedAt", DateTime, nullable=True)
    # phoneNumber plugin. Stored as +639XXXXXXXXX (lib/auth.ts validator).
    phone_number = Column("phoneNumber", String, nullable=True, unique=True)
    phone_number_verified = Column("phoneNumberVerified", Boolean, nullable=True)
    # admin plugin
    role = Column(Text, nullable=True)
    banned = Column(Boolean, nullable=True)
    ban_reason = Column("banReason", Text, nullable=True)
    ban_expires = Column("banExpires", DateTime, nullable=True)
    # twoFactor plugin
    two_factor_enabled = Column("twoFactorEnabled", Boolean, nullable=True)


@event.listens_for(Session, "before_flush")
def _refuse_identity_writes(session: Session, _flush_context, _instances) -> None:
    for obj in (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, AuthIdentity):
            raise RuntimeError(
                "BetterAuth's user table is read-only here; "
                "use app/services/better_auth_store.py"
            )

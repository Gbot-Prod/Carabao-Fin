"""BetterAuth's tables for SQLite tests, and users that have an identity.

Identity (name, email, phone, role, ban, 2FA) lives only in BetterAuth's "user"
table, so a test user is two rows: the identity and the backend ``User``.
``make_user`` creates both. Identity rows are inserted with plain SQL, the way
BetterAuth writes them; the ORM refuses to write them (app/models/auth_identity.py).
"""

from __future__ import annotations

import itertools
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.auth_identity import PLACEHOLDER_EMAIL_DOMAIN, AuthIdentity
from app.models.user import User

_ids = itertools.count(1)
_AUTO = object()


def create_tables(db: Session) -> None:
    """The "user" table (from the model) and a minimal "session" table."""
    AuthIdentity.__table__.create(db.get_bind(), checkfirst=True)
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS "session" (
                id TEXT PRIMARY KEY,
                "userId" TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
            )
            """
        )
    )
    db.commit()


def add_identity(db: Session, identity_id: str, **columns: Any) -> None:
    """Insert a BetterAuth user. Column names as BetterAuth spells them."""
    columns = {
        "id": identity_id,
        "name": "",
        "email": f"{identity_id}@example.com",
        "emailVerified": True,
        **columns,
    }
    db.execute(AuthIdentity.__table__.insert().values(**_by_key(columns)))
    db.commit()


def _by_key(columns: dict[str, Any]) -> dict[str, Any]:
    """BetterAuth column names -> AuthIdentity column keys."""
    names = {c.name: c.key for c in AuthIdentity.__table__.columns}
    return {names.get(k, k): v for k, v in columns.items()}


def get_identity(db: Session, identity_id: str) -> dict | None:
    row = (
        db.execute(text('SELECT * FROM "user" WHERE id = :id'), {"id": identity_id})
        .mappings()
        .first()
    )
    return dict(row) if row else None


def make_user(
    db: Session,
    email: str | None = None,
    *,
    name: str | None = None,
    phone_number: str | None = _AUTO,  # type: ignore[assignment]
    phone_verified: bool = True,
    email_verified: bool = True,
    is_admin: bool = False,
    banned: bool = False,
    ban_reason: str | None = None,
    two_factor: bool = False,
    identity_id: str | None = None,
    **user_fields: Any,
) -> User:
    """A BetterAuth identity plus its backend ``User``, added and flushed.

    Like a phone signup, it gets a verified number unless ``phone_number`` is
    given (None: none, as for a Google sign-in). No email means a phone signup's
    placeholder address. Commit is left to the caller, as with ``db.add``.
    """
    create_tables(db)
    n = next(_ids)
    identity_id = identity_id or f"ba_test_{n}"
    if phone_number is _AUTO:
        phone_number = f"+63917{n:07d}"
    add_identity(
        db,
        identity_id,
        name=name or "",
        email=email or f"{identity_id}@{PLACEHOLDER_EMAIL_DOMAIN}",
        emailVerified=bool(email) and email_verified,
        phoneNumber=phone_number,
        phoneNumberVerified=bool(phone_number) and phone_verified,
        role="admin" if is_admin else "user",
        banned=banned,
        banReason=ban_reason if banned else None,
        twoFactorEnabled=two_factor,
    )
    user_fields.setdefault("notifications_preferences", {})
    user = User(external_auth_id=identity_id, **user_fields)
    db.add(user)
    db.flush()
    return user


def set_identity(db: Session, user: User, **columns: Any) -> None:
    """Change a user's BetterAuth row, as BetterAuth would (e.g. banned=True)."""
    db.execute(
        AuthIdentity.__table__.update()
        .where(AuthIdentity.id == user.external_auth_id)
        .values(**_by_key(columns))
    )
    db.commit()  # expires the loaded identity too


def break_user_table(db: Session) -> None:
    """Make every write to "user" fail while the table still exists."""
    db.execute(
        text(
            """
            CREATE TRIGGER fail_user_writes BEFORE UPDATE ON "user"
            BEGIN SELECT RAISE(ABORT, 'BetterAuth down'); END
            """
        )
    )
    db.execute(
        text(
            """
            CREATE TRIGGER fail_user_deletes BEFORE DELETE ON "user"
            BEGIN SELECT RAISE(ABORT, 'BetterAuth down'); END
            """
        )
    )
    db.commit()

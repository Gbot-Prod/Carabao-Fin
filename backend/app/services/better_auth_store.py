"""The only place the backend writes BetterAuth's tables.

BetterAuth (the Next.js app) owns "user", "session", "account" and friends, and
is the only source of identity. The backend reads "user" through the read-only
``User.identity`` (app/models/auth_identity.py) and writes it only for admin
actions and its own profile data, in the same transaction as the backend change:

- suspending / reinstating (admin plugin's ``banned`` / ``banReason``; a ban
  also ends the user's sessions so no new access token can be fetched), and
  deactivating / reactivating an admin (the same columns),
- admin accounts (documentation/manuals/DB_ROLE_SPLIT_PLAN.md section 2): an
  invited admin's "user" row (no password yet), the invite code and its attempt
  counter, and the password written when the invite is accepted. There is no
  promotion: the role is only ever set when the row is made,
- admin 2FA enrolment: the one-time setup token (a "verification" row that
  lib/auth.ts checks on /two-factor/enable) and an admin's 2FA reset,
- the uploaded avatar (``image``), so the BetterAuth session shows it too,
- deleting a non-admin account (its sessions, logins and 2FA rows cascade),
- creating an admin account with email + password (scripts/make_admin.py
  --create).

Name, email and phone are changed by the BetterAuth client, never here. A failed
write raises (503) so the whole request rolls back.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
import string
import unicodedata
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.orm.util import identity_key

from app.models.auth_identity import AuthIdentity

logger = logging.getLogger(__name__)

UNAVAILABLE_DETAIL = "Couldn't update your sign-in account. Please try again."


def _fail(what: str, exc: Exception) -> None:
    logger.error("[better-auth] Could not %s: %s", what, exc)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNAVAILABLE_DETAIL
    ) from exc


def _run(
    db: Session, what: str, identity_id: str, statements: list[tuple[str, dict]]
) -> None:
    try:
        with db.begin_nested():
            for sql, params in statements:
                db.execute(text(sql), params)
    except SQLAlchemyError as exc:
        _fail(what, exc)
    # Plain SQL bypasses the ORM: reload the identity a User already holds.
    loaded = db.identity_map.get(identity_key(AuthIdentity, identity_id))
    if loaded is not None:
        db.expire(loaded)


def _is_postgres(db: Session) -> bool:
    return db.get_bind().dialect.name == "postgresql"


def _as_datetime(value: datetime | str) -> datetime:
    # SQLite (tests) returns text or naive datetimes; Postgres aware ones.
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


# ── Passwords and ids, as BetterAuth makes them ─────────────────────────────

# @better-auth/utils/password: scrypt N=16384, r=16, p=1, 64 bytes, over the
# NFKC form of the password; the salt is 16 random bytes as hex, and that hex
# text is the scrypt salt. Stored as "<salt>:<key hex>".
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P, _SCRYPT_LEN = 16384, 16, 1, 64
_SCRYPT_MAXMEM = 128 * _SCRYPT_N * _SCRYPT_R * 2 + 1024 * 1024

_ID_ALPHABET = string.ascii_letters + string.digits


def hash_password(password: str, *, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    key = hashlib.scrypt(
        unicodedata.normalize("NFKC", password).encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_LEN,
        maxmem=_SCRYPT_MAXMEM,
    )
    return f"{salt}:{key.hex()}"


def stored_password(db: Session, identity_id: str | None) -> str | None:
    """The account's password hash, or None when it has no password
    (Google/Facebook sign-in only, or an admin invite not accepted yet).
    A read, not a write."""
    if not identity_id:
        return None
    stored = db.execute(
        text(
            'SELECT password FROM "account" WHERE "userId" = :uid '
            "AND \"providerId\" = 'credential' AND password IS NOT NULL"
        ),
        {"uid": identity_id},
    ).scalar()
    return stored if stored and ":" in stored else None


def has_credential_account(db: Session, identity_id: str) -> bool:
    """Whether the account has a "credential" row at all (with or without a
    password). An admin invite can be accepted only while it has none."""
    return (
        db.execute(
            text(
                'SELECT 1 FROM "account" WHERE "userId" = :uid '
                "AND \"providerId\" = 'credential'"
            ),
            {"uid": identity_id},
        ).first()
        is not None
    )


def identities_with_password(db: Session, identity_ids: list[str]) -> set[str]:
    """Which of these accounts have a "credential" row (the users list)."""
    if not identity_ids:
        return set()
    params = {f"u{i}": uid for i, uid in enumerate(identity_ids)}
    names = ", ".join(f":{key}" for key in params)
    rows = db.execute(
        text(
            'SELECT DISTINCT "userId" FROM "account" '
            f'WHERE "providerId" = \'credential\' AND "userId" IN ({names})'
        ),
        params,
    ).all()
    return {row[0] for row in rows}


def password_matches(stored: str, password: str) -> bool:
    """Whether ``password`` gives the hash ``stored`` (from stored_password)."""
    salt = stored.split(":", 1)[0]
    return hmac.compare_digest(hash_password(password, salt=salt), stored)


def new_id() -> str:
    """32 letters and digits, like BetterAuth's generateId()."""
    return "".join(secrets.choice(_ID_ALPHABET) for _ in range(32))


def email_taken(db: Session, email: str) -> bool:
    """Whether any BetterAuth user (any role) has this email. A read."""
    return (
        db.execute(
            text('SELECT 1 FROM "user" WHERE lower(email) = lower(:email)'),
            {"email": email},
        ).first()
        is not None
    )


def lock_active_admins(db: Session) -> list[str]:
    """Lock every admin row that is not banned (FOR UPDATE, until the
    transaction ends) and return the ids of those that can sign in (2FA on).
    Two admins deactivating each other at the same moment queue here, and the
    second one sees the first one's change. SQLite (tests) has no row locks."""
    sql = (
        'SELECT id, "twoFactorEnabled" FROM "user" '
        "WHERE role = 'admin' AND banned IS NOT TRUE"
    )
    if _is_postgres(db):
        sql += " FOR UPDATE"
    return [row[0] for row in db.execute(text(sql)).all() if row[1]]


# ── Writes ──────────────────────────────────────────────────────────────────


def _admin_user_row(
    identity_id: str, *, email: str, name: str, email_verified: bool
) -> tuple[str, dict]:
    now = datetime.now(UTC)
    return (
        'INSERT INTO "user" (id, name, email, "emailVerified", role, banned, '
        '"twoFactorEnabled", "createdAt", "updatedAt") VALUES (:id, :name, :email, '
        ":verified, 'admin', false, false, :now, :now)",
        {
            "id": identity_id,
            "name": name,
            "email": email,
            "verified": email_verified,
            "now": now,
        },
    )


def _password_row(identity_id: str, password: str) -> tuple[str, dict]:
    now = datetime.now(UTC)
    return (
        'INSERT INTO "account" (id, "accountId", "providerId", "userId", '
        'password, "createdAt", "updatedAt") VALUES (:aid, :uid, '
        "'credential', :uid, :password, :now, :now)",
        {
            "aid": new_id(),
            "uid": identity_id,
            "password": hash_password(password),
            "now": now,
        },
    )


def create_admin_with_password(
    db: Session, *, email: str, name: str, password: str
) -> str:
    """An admin that signs in with email + password (email verified), for
    scripts/make_admin.py --create. 2FA stays off until the admin sets it up
    with the setup link. Returns its id. The caller commits."""
    identity_id = new_id()
    _run(
        db,
        "create the account",
        identity_id,
        [
            _admin_user_row(identity_id, email=email, name=name, email_verified=True),
            _password_row(identity_id, password),
        ],
    )
    return identity_id


def create_admin_invitee(db: Session, *, email: str, name: str) -> str:
    """An invited admin: role admin, email not verified yet, 2FA off and no
    "account" row, so no password until the invite is accepted. Returns its
    id. The caller commits."""
    identity_id = new_id()
    _run(
        db,
        "create the invited admin",
        identity_id,
        [_admin_user_row(identity_id, email=email, name=name, email_verified=False)],
    )
    return identity_id


def accept_admin_invite(db: Session, identity_id: str, *, password: str) -> None:
    """The accepted invite's password ("credential" account, BetterAuth's
    scrypt format), the email marked verified (the link went to it) and the
    invite code removed. The setup token stays: TOTP setup still needs it."""
    _run(
        db,
        "save the password",
        identity_id,
        [
            _password_row(identity_id, password),
            (
                'UPDATE "user" SET "emailVerified" = true, '
                '"updatedAt" = CURRENT_TIMESTAMP WHERE id = :id',
                {"id": identity_id},
            ),
            (
                'DELETE FROM "verification" WHERE identifier = :identifier',
                {"identifier": invite_code_identifier(identity_id)},
            ),
        ],
    )


def delete_admin_password(db: Session, identity_id: str) -> None:
    """Remove an admin's password ("credential" row), so the account is an
    open invite again (admin account reset). The database lets the API delete
    only an admin's credential row (guards.sql api_delete_admin_password)."""
    _run(
        db,
        "remove the password",
        identity_id,
        [
            (
                'DELETE FROM "account" WHERE "userId" = :id '
                "AND \"providerId\" = 'credential'",
                {"id": identity_id},
            )
        ],
    )


def set_password(db: Session, identity_id: str, *, password: str) -> None:
    """A password for an account that has none (scripts/make_admin.py
    --recover, for an admin who never accepted the invite)."""
    _run(db, "save the password", identity_id, [_password_row(identity_id, password)])


def set_banned(
    db: Session, identity_id: str | None, *, banned: bool, reason: str | None
) -> None:
    if not identity_id:
        return
    statements = [
        (
            'UPDATE "user" SET banned = :banned, "banReason" = :reason, '
            '"banExpires" = NULL WHERE id = :id',
            {"banned": banned, "reason": reason if banned else None, "id": identity_id},
        )
    ]
    if banned:
        statements.append(
            ('DELETE FROM "session" WHERE "userId" = :id', {"id": identity_id})
        )
    _run(db, "update the ban", identity_id, statements)


# ── Verification rows: setup tokens and invite codes ────────────────────────
# Identifiers are stored in plain text (lib/auth.ts sets no
# verification.storeIdentifier and no secondaryStorage). The database guards
# (DB_ROLE_SPLIT_PLAN.md section 4, G3) match on these prefixes.

ENROLMENT_IDENTIFIER_PREFIX = "admin-2fa-enrol-"
INVITE_CODE_IDENTIFIER_PREFIX = "admin-invite-code-"


def enrolment_identifier(identity_id: str) -> str:
    """Keep in step with lib/admin-two-factor.ts enrolmentIdentifier()."""
    return f"{ENROLMENT_IDENTIFIER_PREFIX}{identity_id}"


def invite_code_identifier(identity_id: str) -> str:
    """The invite's out-of-band code. Only the API reads or writes it."""
    return f"{INVITE_CODE_IDENTIFIER_PREFIX}{identity_id}"


def _replace_verification(
    identifier: str, value: str, expires_at: datetime
) -> list[tuple[str, dict]]:
    now = datetime.now(UTC)
    return [
        (
            'DELETE FROM "verification" WHERE identifier = :identifier',
            {"identifier": identifier},
        ),
        (
            'INSERT INTO "verification" (id, identifier, value, "expiresAt", '
            '"createdAt", "updatedAt") VALUES (:vid, :identifier, :value, '
            ":expires, :now, :now)",
            {
                "vid": secrets.token_urlsafe(24),
                "identifier": identifier,
                "value": value,
                "expires": expires_at,
                "now": now,
            },
        ),
    ]


def verification_row(
    db: Session, identifier: str, *, lock: bool = False
) -> tuple[str, datetime] | None:
    """(value, expiresAt) of the row, or None. ``lock`` holds the row
    FOR UPDATE until the transaction ends (Postgres only)."""
    sql = 'SELECT value, "expiresAt" FROM "verification" WHERE identifier = :i'
    if lock and _is_postgres(db):
        sql += " FOR UPDATE"
    row = db.execute(text(sql), {"i": identifier}).first()
    if row is None:
        return None
    return row[0], _as_datetime(row[1])


def set_enrolment_token(
    db: Session, identity_id: str, *, token_hash: str, expires_at: datetime
) -> None:
    """Replace the user's admin 2FA setup token (CF-0018). Only its SHA-256
    is stored; BetterAuth deletes the row when setup finishes."""
    _run(
        db,
        "save the two-step setup link",
        identity_id,
        _replace_verification(
            enrolment_identifier(identity_id), token_hash, expires_at
        ),
    )


def set_invite_code(
    db: Session, identity_id: str, *, code_hash: str, expires_at: datetime
) -> None:
    """Replace the invite code. Stored as "<SHA-256>:<failed attempts>"."""
    _run(
        db,
        "save the invite code",
        identity_id,
        _replace_verification(
            invite_code_identifier(identity_id), f"{code_hash}:0", expires_at
        ),
    )


def set_invite_code_attempts(
    db: Session, identity_id: str, *, code_hash: str, attempts: int
) -> None:
    _run(
        db,
        "count the attempt",
        identity_id,
        [
            (
                'UPDATE "verification" SET value = :value, '
                '"updatedAt" = CURRENT_TIMESTAMP WHERE identifier = :identifier',
                {
                    "value": f"{code_hash}:{attempts}",
                    "identifier": invite_code_identifier(identity_id),
                },
            )
        ],
    )


def delete_invite(db: Session, identity_id: str) -> None:
    """End an invite: its code and its setup token both go."""
    _run(
        db,
        "end the invite",
        identity_id,
        [
            (
                'DELETE FROM "verification" WHERE identifier IN (:code, :token)',
                {
                    "code": invite_code_identifier(identity_id),
                    "token": enrolment_identifier(identity_id),
                },
            )
        ],
    )


def clear_two_factor(db: Session, identity_id: str | None) -> None:
    """Turn 2FA off for an account: its TOTP secret and backup codes, its
    trusted devices, any open setup token and invite code, and all its
    sessions go. Used for an admin's 2FA reset by another admin, for a
    deactivated admin and by scripts/make_admin.py --recover."""
    if not identity_id:
        return
    params = {"id": identity_id}
    _run(
        db,
        "reset two-step verification",
        identity_id,
        [
            ('DELETE FROM "twoFactor" WHERE "userId" = :id', params),
            (
                'UPDATE "user" SET "twoFactorEnabled" = false, '
                '"updatedAt" = CURRENT_TIMESTAMP WHERE id = :id',
                params,
            ),
            (
                'DELETE FROM "verification" WHERE value = :id '
                "AND identifier LIKE 'trust-device-%'",
                params,
            ),
            (
                'DELETE FROM "verification" WHERE identifier IN (:token, :code)',
                {
                    "token": enrolment_identifier(identity_id),
                    "code": invite_code_identifier(identity_id),
                },
            ),
            ('DELETE FROM "session" WHERE "userId" = :id', params),
        ],
    )


def set_image(db: Session, identity_id: str | None, url: str | None) -> None:
    """Copy an uploaded avatar to the BetterAuth user so its session shows it."""
    if not identity_id:
        return
    _run(
        db,
        "update the profile picture",
        identity_id,
        [
            (
                'UPDATE "user" SET image = :image, "updatedAt" = CURRENT_TIMESTAMP '
                "WHERE id = :id",
                {"image": url, "id": identity_id},
            )
        ],
    )


def delete_identity(db: Session, identity_id: str | None) -> None:
    """Remove the BetterAuth user; sessions, accounts and 2FA rows cascade.
    Never an admin's (callers refuse admin accounts)."""
    if not identity_id:
        return
    _run(
        db,
        "delete the identity",
        identity_id,
        [('DELETE FROM "user" WHERE id = :id', {"id": identity_id})],
    )

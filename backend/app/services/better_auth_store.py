"""The only place the backend writes BetterAuth's tables.

BetterAuth (the Next.js app) owns "user", "session", "account" and friends, and
is the only source of identity. The backend reads "user" through the read-only
``User.identity`` (app/models/auth_identity.py) and writes it only for admin
actions and its own profile data, in the same transaction as the backend change:

- suspending / reinstating (admin plugin's ``banned`` / ``banReason``; a ban
  also ends the user's sessions so no new access token can be fetched),
- changing the admin role (admin plugin's ``role``),
- admin 2FA enrolment: the one-time setup token (a "verification" row that
  lib/auth.ts checks on /two-factor/enable) and an admin's 2FA reset,
- the uploaded avatar (``image``), so the BetterAuth session shows it too,
- deleting an account (its sessions, logins and 2FA rows cascade),
- creating an admin account with email + password (scripts/make_admin.py
  --create only; there is no HTTP endpoint for it).

Name, email and phone are changed by the BetterAuth client, never here. A failed
write raises (503) so the whole request rolls back.
"""

from __future__ import annotations

import hashlib
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


def new_id() -> str:
    """32 letters and digits, like BetterAuth's generateId()."""
    return "".join(secrets.choice(_ID_ALPHABET) for _ in range(32))


# ── Writes ──────────────────────────────────────────────────────────────────


def create_email_identity(db: Session, *, email: str, name: str, password: str) -> str:
    """A BetterAuth user that signs in with email + password (email verified),
    for scripts/make_admin.py --create. Returns its id. The caller sets the role
    and commits."""
    identity_id = new_id()
    now = datetime.now(UTC)
    _run(
        db,
        "create the account",
        identity_id,
        [
            (
                'INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", '
                '"updatedAt") VALUES (:id, :name, :email, :verified, :now, :now)',
                {
                    "id": identity_id,
                    "name": name,
                    "email": email,
                    "verified": True,
                    "now": now,
                },
            ),
            (
                'INSERT INTO "account" (id, "accountId", "providerId", "userId", '
                'password, "createdAt", "updatedAt") VALUES (:aid, :uid, '
                "'credential', :uid, :password, :now, :now)",
                {
                    "aid": new_id(),
                    "uid": identity_id,
                    "password": hash_password(password),
                    "now": now,
                },
            ),
        ],
    )
    return identity_id


def set_banned(
    db: Session, identity_id: str | None, *, banned: bool, reason: str | None
) -> None:
    if not identity_id:
        return
    statements = [
        (
            'UPDATE "user" SET banned = :banned, "banReason" = :reason WHERE id = :id',
            {"banned": banned, "reason": reason if banned else None, "id": identity_id},
        )
    ]
    if banned:
        statements.append(
            ('DELETE FROM "session" WHERE "userId" = :id', {"id": identity_id})
        )
    _run(db, "update the ban", identity_id, statements)


def set_role(db: Session, identity_id: str | None, *, is_admin: bool) -> None:
    if not identity_id:
        return
    _run(
        db,
        "update the role",
        identity_id,
        [
            (
                'UPDATE "user" SET role = :role WHERE id = :id',
                {"role": "admin" if is_admin else "user", "id": identity_id},
            ),
            # A role change ends every session. A promoted user loses the buyer
            # session (the public site gives admins no session); a demoted admin
            # loses the admin session.
            ('DELETE FROM "session" WHERE "userId" = :id', {"id": identity_id}),
        ],
    )


ENROLMENT_IDENTIFIER_PREFIX = "admin-2fa-enrol-"


def enrolment_identifier(identity_id: str) -> str:
    """Keep in step with lib/admin-two-factor.ts enrolmentIdentifier()."""
    return f"{ENROLMENT_IDENTIFIER_PREFIX}{identity_id}"


def set_enrolment_token(
    db: Session, identity_id: str, *, token_hash: str, expires_at: datetime
) -> None:
    """Replace the user's admin 2FA setup token (CF-0018). Only its SHA-256
    is stored; BetterAuth deletes the row when setup finishes."""
    identifier = enrolment_identifier(identity_id)
    now = datetime.now(UTC)
    _run(
        db,
        "save the two-step setup link",
        identity_id,
        [
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
                    "value": token_hash,
                    "expires": expires_at,
                    "now": now,
                },
            ),
        ],
    )


def clear_two_factor(db: Session, identity_id: str | None) -> None:
    """Turn 2FA off for an account: its TOTP secret and backup codes, its
    trusted devices, any open setup token and all its sessions go. Used for a
    demoted admin and for an admin's 2FA reset by another admin."""
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
                'DELETE FROM "verification" WHERE identifier = :identifier',
                {"identifier": enrolment_identifier(identity_id)},
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
    """Remove the BetterAuth user; sessions, accounts and 2FA rows cascade."""
    if not identity_id:
        return
    _run(
        db,
        "delete the identity",
        identity_id,
        [('DELETE FROM "user" WHERE id = :id', {"id": identity_id})],
    )

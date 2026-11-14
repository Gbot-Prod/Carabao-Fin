"""The only place the backend writes BetterAuth's tables.

BetterAuth (the Next.js app) owns "user", "session", "account" and friends, and
is the only source of identity. The backend reads "user" through the read-only
``User.identity`` (app/models/auth_identity.py) and writes it only for admin
actions and its own profile data, in the same transaction as the backend change:

- suspending / reinstating (admin plugin's ``banned`` / ``banReason``; a ban
  also ends the user's sessions so no new access token can be fetched),
- changing the admin role (admin plugin's ``role``),
- the uploaded avatar (``image``), so the BetterAuth session shows it too,
- deleting an account (its sessions, logins and 2FA rows cascade).

Name, email and phone are changed by the BetterAuth client, never here. A failed
write raises (503) so the whole request rolls back.
"""

from __future__ import annotations

import logging

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


# ── Writes ──────────────────────────────────────────────────────────────────


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
            )
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

"""The only place the backend touches BetterAuth's tables.

BetterAuth (the Next.js app) owns "user", "session", "account" and friends. The
backend reads and writes them where its own change must show up at sign-in or in
the BetterAuth session at once, in the same transaction as the backend change:

- suspending / reinstating (admin plugin's ``banned`` / ``banReason``; a ban
  also ends the user's sessions so no new access token can be fetched),
- changing the admin role (admin plugin's ``role``),
- profile edits that BetterAuth also shows (``name``, ``phoneNumber``, ``image``),
- deleting an account (its sessions, logins and 2FA rows cascade),
- reading ``twoFactorEnabled`` live for the admin 2FA requirement.

Only columns from BetterAuth's core, admin- and two-factor-plugin schema and our
``phoneNumber`` field are used. A failed write raises (503) so the whole request
rolls back; it is skipped only when the BetterAuth "user" table doesn't exist (a
backend-only database, e.g. in tests).
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlalchemy import bindparam, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    from app.models.user import User

logger = logging.getLogger(__name__)

UNAVAILABLE_DETAIL = "Couldn't update your sign-in account. Please try again."


def _tables_exist(db: Session) -> bool:
    try:
        return inspect(db.connection()).has_table("user")
    except SQLAlchemyError:
        return True  # can't tell; treat the failure as real


def _fail(db: Session, what: str, exc: Exception) -> None:
    """Raise unless the failure is just "no BetterAuth tables here"."""
    if not _tables_exist(db):
        return
    logger.error("[better-auth] Could not %s: %s", what, exc)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNAVAILABLE_DETAIL
    ) from exc


def _run(db: Session, what: str, statements: list[tuple[str, dict]]) -> None:
    try:
        with db.begin_nested():
            for sql, params in statements:
                db.execute(text(sql), params)
    except SQLAlchemyError as exc:
        _fail(db, what, exc)


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
    _run(db, "update the ban", statements)


def set_role(db: Session, identity_id: str | None, *, is_admin: bool) -> None:
    if not identity_id:
        return
    _run(
        db,
        "update the role",
        [
            (
                'UPDATE "user" SET role = :role WHERE id = :id',
                {"role": "admin" if is_admin else "user", "id": identity_id},
            )
        ],
    )


# Backend field -> BetterAuth "user" column, for profile write-back.
_PROFILE_COLUMNS = {
    "name": "name",
    "phone_number": "phoneNumber",
    "profile_picture_url": "image",
}


def update_profile(db: Session, identity_id: str | None, changes: dict) -> None:
    """Copy edited profile fields to the BetterAuth user so its session matches.

    ``changes`` uses backend field names; fields BetterAuth doesn't hold are
    ignored. BetterAuth's ``name`` is NOT NULL, so a cleared name is stored as "".
    """
    if not identity_id:
        return
    params: dict = {"id": identity_id}
    sets = []
    for field, column in _PROFILE_COLUMNS.items():
        if field not in changes:
            continue
        value = changes[field]
        if field == "name":
            value = value or ""
        params[field] = value
        sets.append(f'"{column}" = :{field}')
    if not sets:
        return
    sets.append('"updatedAt" = CURRENT_TIMESTAMP')
    _run(
        db,
        "update the profile",
        [(f'UPDATE "user" SET {", ".join(sets)} WHERE id = :id', params)],
    )


def delete_identity(db: Session, identity_id: str | None) -> None:
    """Remove the BetterAuth user; sessions, accounts and 2FA rows cascade."""
    if not identity_id:
        return
    _run(
        db,
        "delete the identity",
        [('DELETE FROM "user" WHERE id = :id', {"id": identity_id})],
    )


# ── Reads ───────────────────────────────────────────────────────────────────


def identity_exists(db: Session, identity_id: str) -> bool:
    """False only when the BetterAuth tables exist and have no such user.

    Guards row creation: a token outlives its user by up to 15 minutes, and a
    deleted account must not come back from it.
    """
    try:
        with db.begin_nested():
            found = db.execute(
                text('SELECT 1 FROM "user" WHERE id = :id'), {"id": identity_id}
            ).first()
    except SQLAlchemyError as exc:
        _fail(db, "look up the identity", exc)
        return True  # no BetterAuth tables here (backend-only database)
    return found is not None


def two_factor_identities(db: Session, identity_ids: Iterable[str | None]) -> set[str]:
    """The given BetterAuth ids that have two-step verification turned on."""
    ids = sorted({i for i in identity_ids if i})
    if not ids:
        return set()
    query = text(
        'SELECT id FROM "user" WHERE id IN :ids AND "twoFactorEnabled" = :on'
    ).bindparams(bindparam("ids", expanding=True))
    try:
        with db.begin_nested():
            return set(db.execute(query, {"ids": ids, "on": True}).scalars())
    except SQLAlchemyError as exc:
        _fail(db, "read two-step verification", exc)
        return set()


def load_two_factor(db: Session, users: Iterable[User]) -> None:
    """Set ``two_factor_enabled`` on each user from BetterAuth, in one query."""
    users = list(users)
    enabled = two_factor_identities(db, (u.external_auth_id for u in users))
    for user in users:
        user.two_factor_enabled = user.external_auth_id in enabled

"""A minimal copy of BetterAuth's tables for SQLite tests.

Only the columns better_auth_store touches. Without these tables the store
skips every read and write, as it does on a backend-only database.
"""

from sqlalchemy import text
from sqlalchemy.orm import Session


def create_tables(db: Session) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS "user" (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                email TEXT NOT NULL DEFAULT '',
                image TEXT,
                "phoneNumber" TEXT,
                role TEXT,
                banned BOOLEAN,
                "banReason" TEXT,
                "twoFactorEnabled" BOOLEAN DEFAULT 0,
                "updatedAt" TIMESTAMP
            )
            """
        )
    )
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


def add_identity(db: Session, identity_id: str, **columns) -> None:
    columns = {"id": identity_id, **columns}
    names = ", ".join(f'"{c}"' for c in columns)
    params = ", ".join(f":{c}" for c in columns)
    db.execute(text(f'INSERT INTO "user" ({names}) VALUES ({params})'), columns)
    db.commit()


def get_identity(db: Session, identity_id: str) -> dict | None:
    row = db.execute(
        text('SELECT * FROM "user" WHERE id = :id'), {"id": identity_id}
    ).mappings().first()
    return dict(row) if row else None


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

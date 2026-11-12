"""BetterAuth two-factor plugin tables (E8a).

BetterAuth owns the "user" table and its plugins' tables; `npm run
auth:migrate:apply` can create these too. Every statement is IF NOT EXISTS so
either route can run first, and nothing happens on a database without the
BetterAuth "user" table (e.g. a backend-only test database).

Revision ID: f4b8c1d7e2a6
Revises: e3f9a2b7c4d1
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4b8c1d7e2a6"
down_revision: str | Sequence[str] | None = "e3f9a2b7c4d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_better_auth(bind) -> bool:
    return (
        bind.execute(sa.text("SELECT to_regclass('public.\"user\"')")).scalar()
        is not None
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or not _has_better_auth(bind):
        return
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" boolean DEFAULT false'
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS "twoFactor" (
            "id" text PRIMARY KEY,
            "secret" text NOT NULL,
            "backupCodes" text NOT NULL,
            "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
            "verified" boolean DEFAULT true
        )
        """
    )
    op.execute(
        'CREATE INDEX IF NOT EXISTS "twoFactor_secret_idx" ON "twoFactor" ("secret")'
    )
    op.execute(
        'CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" ON "twoFactor" ("userId")'
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or not _has_better_auth(bind):
        return
    op.execute('DROP TABLE IF EXISTS "twoFactor"')
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS "twoFactorEnabled"')

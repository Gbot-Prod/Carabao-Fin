"""BetterAuth admin plugin columns.

The backend writes "user".role / banned / banReason (better_auth_store), but
only `npm run auth:migrate:apply` created them, so a database set up with
Alembic alone had no such columns and admin actions failed. Every statement is
IF NOT EXISTS, so either route can run first, and nothing happens on a database
without the BetterAuth "user" table (like f4b8c1d7e2a6).

Revision ID: e8b2d6f0a4c7
Revises: d7a2e4c6f8b1
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e8b2d6f0a4c7"
down_revision: str | Sequence[str] | None = "d7a2e4c6f8b1"
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
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text')
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" boolean')
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" text')
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" timestamptz')
    op.execute('ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonatedBy" text')


def downgrade() -> None:
    # The columns may have been created by BetterAuth's own migration and hold
    # live ban/role data, so they are left in place.
    pass

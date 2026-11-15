"""BetterAuth session "mfaVerified" (CF-0017).

True when the session passed the authenticator-code step. lib/auth.ts sets it
and sends it to the backend as the "mfa" claim; the admin API requires it.
`npm run auth:migrate:apply` can add it too, so the statement is IF NOT EXISTS,
and nothing happens on a database without the BetterAuth tables.

Existing sessions get NULL (false), so admins must sign in again with the code.

Revision ID: a9e2c4f6b8d1
Revises: b4e8d2a6f1c9
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a9e2c4f6b8d1"
down_revision: str | Sequence[str] | None = "b4e8d2a6f1c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_session_table(bind) -> bool:
    return (
        bind.execute(sa.text("SELECT to_regclass('public.\"session\"')")).scalar()
        is not None
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or not _has_session_table(bind):
        return
    op.execute('ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "mfaVerified" boolean')


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or not _has_session_table(bind):
        return
    op.execute('ALTER TABLE "session" DROP COLUMN IF EXISTS "mfaVerified"')

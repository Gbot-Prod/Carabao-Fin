"""BetterAuth as the only identity provider, step 1 (additive).

- "jwks": the BetterAuth jwt plugin's signing keys (private keys are encrypted
  with BETTER_AUTH_SECRET). FastAPI reads the public half over /api/auth/jwks.
- "user"."phoneNumber": the number a phone signup verified, carried in the
  access token so the backend row can be created with it.

Safe to run before the new code is deployed. Step 2 (c9f1a3e5b7d2) drops
mobile_credentials and must wait until the old backend is gone.

BetterAuth statements are IF NOT EXISTS and skipped on a database without the
BetterAuth "user" table, like f4b8c1d7e2a6.

Revision ID: b7e2d4f6a8c1
Revises: a1c3e5f7b9d2
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b7e2d4f6a8c1"
down_revision: str | Sequence[str] | None = "a1c3e5f7b9d2"
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
        """
        CREATE TABLE IF NOT EXISTS "jwks" (
            "id" text PRIMARY KEY,
            "publicKey" text NOT NULL,
            "privateKey" text NOT NULL,
            "createdAt" timestamptz NOT NULL,
            "expiresAt" timestamptz
        )
        """
    )
    op.execute('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phoneNumber" text')


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or not _has_better_auth(bind):
        return
    op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS "phoneNumber"')
    op.execute('DROP TABLE IF EXISTS "jwks"')

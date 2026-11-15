"""Two-step verification is admins only: turn it off for everyone else.

Sign-in asks for a code whenever "twoFactorEnabled" is set, so non-admins who
turned it on earlier would keep being asked. Their TOTP secrets are deleted.
Nothing happens on a database without the BetterAuth "user" table.

Revision ID: d7a2e4c6f8b1
Revises: c9f1a3e5b7d2
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d7a2e4c6f8b1"
down_revision: str | Sequence[str] | None = "c9f1a3e5b7d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _exists(bind, table: str) -> bool:
    return (
        bind.execute(sa.text(f"SELECT to_regclass('public.\"{table}\"')")).scalar()
        is not None
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or not _exists(bind, "user"):
        return
    if _exists(bind, "twoFactor"):
        op.execute(
            'DELETE FROM "twoFactor" WHERE "userId" IN '
            '(SELECT id FROM "user" WHERE role IS DISTINCT FROM \'admin\')'
        )
    has_flag = bind.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'user' AND column_name = 'twoFactorEnabled'"
        )
    ).scalar()
    if has_flag:
        op.execute(
            'UPDATE "user" SET "twoFactorEnabled" = false '
            "WHERE role IS DISTINCT FROM 'admin' AND \"twoFactorEnabled\" IS TRUE"
        )
    op.execute(
        "UPDATE backend_users SET two_factor_enabled = false "
        "WHERE NOT is_admin AND two_factor_enabled"
    )


def downgrade() -> None:
    # Deleted secrets can't be restored; users can turn it on again if allowed.
    pass

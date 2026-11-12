"""Remember whether a user has two-step verification on (E8c).

Synced from BetterAuth at /auth/sync; admin endpoints require it.

Revision ID: a1c9e5f3b7d8
Revises: f4b8c1d7e2a6
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c9e5f3b7d8"
down_revision: str | Sequence[str] | None = "f4b8c1d7e2a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "backend_users",
        sa.Column(
            "two_factor_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("backend_users", "two_factor_enabled")

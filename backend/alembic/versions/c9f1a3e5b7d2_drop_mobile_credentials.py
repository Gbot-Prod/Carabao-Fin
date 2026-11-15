"""BetterAuth as the only identity provider, step 2: drop mobile_credentials.

The app signs in through BetterAuth now, so the backend's copy of app passwords
(bcrypt) is unused. Run only once the new backend is deployed (the old one reads
this table on mobile sign-in) and scripts/migrate_mobile_users.py has run.

Revision ID: c9f1a3e5b7d2
Revises: b7e2d4f6a8c1
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c9f1a3e5b7d2"
down_revision: str | Sequence[str] | None = "b7e2d4f6a8c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mobile_credentials")


def downgrade() -> None:
    # Recreates the empty table only; the dropped password hashes are gone.
    op.create_table(
        "mobile_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )

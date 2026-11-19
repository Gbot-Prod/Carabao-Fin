"""Merchant holiday mode: pause orders until a date (CF-0066).

Revision ID: c9e1a3b5d7f2
Revises: b7d9f1a3c5e8
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9e1a3b5d7f2"
down_revision: str | Sequence[str] | None = "b7d9f1a3c5e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, no default: adding them does not rewrite the table.
    op.add_column("merchants", sa.Column("paused_until", sa.Date(), nullable=True))
    op.add_column(
        "merchants", sa.Column("pause_message", sa.String(200), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("merchants", "pause_message")
    op.drop_column("merchants", "paused_until")

"""Buyers hide orders from their history instead of deleting them (CF-0070).

Revision ID: d1f3a5c7e9b2
Revises: c9e1a3b5d7f2
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d1f3a5c7e9b2"
down_revision: str | Sequence[str] | None = "c9e1a3b5d7f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, no default: adding it does not rewrite the table.
    op.add_column(
        "orders",
        sa.Column("hidden_by_buyer_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("orders", "hidden_by_buyer_at")

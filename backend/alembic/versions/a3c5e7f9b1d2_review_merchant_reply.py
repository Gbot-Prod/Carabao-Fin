"""Merchants can reply once to each review of their farm (CF-0043).

Revision ID: a3c5e7f9b1d2
Revises: e4a8c2f6b0d3
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c5e7f9b1d2"
down_revision: str | Sequence[str] | None = "e4a8c2f6b0d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, no default: adding them does not rewrite the table.
    op.add_column("reviews", sa.Column("merchant_reply", sa.Text(), nullable=True))
    op.add_column(
        "reviews",
        sa.Column("merchant_replied_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("reviews", "merchant_replied_at")
    op.drop_column("reviews", "merchant_reply")

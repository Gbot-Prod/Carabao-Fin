"""Merchant low-stock threshold for dashboard alerts (F1).

Revision ID: a1c3e5f7b9d2
Revises: f6b8d0c2e4a3
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1c3e5f7b9d2"
down_revision: str | Sequence[str] | None = "f6b8d0c2e4a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "merchants",
        sa.Column(
            "low_stock_threshold", sa.Integer(), nullable=False, server_default="5"
        ),
    )


def downgrade() -> None:
    op.drop_column("merchants", "low_stock_threshold")

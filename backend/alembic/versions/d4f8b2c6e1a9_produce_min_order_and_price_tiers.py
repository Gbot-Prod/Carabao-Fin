"""Store each produce listing's minimum order quantity and bulk price tiers.

Revision ID: d4f8b2c6e1a9
Revises: c7d1e9a3b5f2
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f8b2c6e1a9"
down_revision: str | Sequence[str] | None = "c7d1e9a3b5f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Existing listings get a minimum order of 1 and no tiers: prices unchanged."""
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("produces")}

    if "min_order_qty" not in columns:
        op.add_column(
            "produces",
            sa.Column(
                "min_order_qty", sa.Integer(), nullable=False, server_default="1"
            ),
        )
    if "price_tiers" not in columns:
        op.add_column(
            "produces",
            sa.Column(
                "price_tiers", sa.JSON(), nullable=False, server_default=sa.text("'[]'")
            ),
        )


def downgrade() -> None:
    """Remove the minimum order and tier columns."""
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("produces")}
    if "price_tiers" in columns:
        op.drop_column("produces", "price_tiers")
    if "min_order_qty" in columns:
        op.drop_column("produces", "min_order_qty")

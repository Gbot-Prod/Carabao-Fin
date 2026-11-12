"""Store the buyer's requested delivery date, time window and notes.

Revision ID: e5b9d3a7c2f1
Revises: b3f1c8d2e4a7
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5b9d3a7c2f1"
down_revision: str | Sequence[str] | None = "b3f1c8d2e4a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add nullable scheduling columns; existing orders keep NULL."""
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("orders")}

    if "requested_delivery_date" not in columns:
        op.add_column(
            "orders", sa.Column("requested_delivery_date", sa.Date(), nullable=True)
        )
        op.create_index(
            "ix_orders_requested_delivery_date", "orders", ["requested_delivery_date"]
        )
    if "delivery_window" not in columns:
        op.add_column("orders", sa.Column("delivery_window", sa.String(), nullable=True))
    if "notes" not in columns:
        op.add_column("orders", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    """Remove the scheduling columns."""
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("orders")}
    if "notes" in columns:
        op.drop_column("orders", "notes")
    if "delivery_window" in columns:
        op.drop_column("orders", "delivery_window")
    if "requested_delivery_date" in columns:
        op.drop_index("ix_orders_requested_delivery_date", table_name="orders")
        op.drop_column("orders", "requested_delivery_date")

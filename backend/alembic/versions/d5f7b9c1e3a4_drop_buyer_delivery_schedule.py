"""Remove the buyer's requested delivery date and time window.

Revision ID: d5f7b9c1e3a4
Revises: c4e6a8b0d2f3
Create Date: 2026-11-26

The farm decides when to deliver (it ships from Ready to ship). Undoes the
date and window part of e5b9d3a7c2f1; orders.notes stays. The downgrade puts
the empty columns back.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5f7b9c1e3a4"
down_revision: str | Sequence[str] | None = "c4e6a8b0d2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("orders", "delivery_window")
    op.drop_index("ix_orders_requested_delivery_date", table_name="orders")
    op.drop_column("orders", "requested_delivery_date")


def downgrade() -> None:
    op.add_column(
        "orders", sa.Column("requested_delivery_date", sa.Date(), nullable=True)
    )
    op.create_index(
        "ix_orders_requested_delivery_date", "orders", ["requested_delivery_date"]
    )
    op.add_column("orders", sa.Column("delivery_window", sa.String(), nullable=True))

"""Track shipping and buyer delivery confirmation on orders.

Revision ID: b3f1c8d2e4a7
Revises: c4a8e2f1d9b3
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b3f1c8d2e4a7"
down_revision: str | Sequence[str] | None = "c4a8e2f1d9b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add delivery timestamps and backfill orders already in flight."""
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("orders")}

    if "shipped_at" not in columns:
        op.add_column(
            "orders", sa.Column("shipped_at", sa.DateTime(timezone=True), nullable=True)
        )
        op.create_index("ix_orders_shipped_at", "orders", ["shipped_at"])
    if "delivered_at" not in columns:
        op.add_column(
            "orders",
            sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "delivery_confirmed_by" not in columns:
        op.add_column(
            "orders", sa.Column("delivery_confirmed_by", sa.String(), nullable=True)
        )

    # In-flight orders get a full confirmation window from deploy time.
    bind.execute(
        sa.text(
            "UPDATE orders SET shipped_at = now() "
            "WHERE status IN ('shipped', 'out_for_delivery') AND shipped_at IS NULL"
        )
    )
    # Orders merchants already marked delivered may have been paid out.
    bind.execute(
        sa.text(
            "UPDATE orders SET delivered_at = now(), delivery_confirmed_by = 'legacy' "
            "WHERE status = 'delivered' AND delivered_at IS NULL"
        )
    )


def downgrade() -> None:
    """Remove the delivery confirmation columns."""
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("orders")}
    if "delivery_confirmed_by" in columns:
        op.drop_column("orders", "delivery_confirmed_by")
    if "delivered_at" in columns:
        op.drop_column("orders", "delivered_at")
    if "shipped_at" in columns:
        op.drop_index("ix_orders_shipped_at", table_name="orders")
        op.drop_column("orders", "shipped_at")

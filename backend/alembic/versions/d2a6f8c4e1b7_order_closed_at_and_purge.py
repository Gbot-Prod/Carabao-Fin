"""Order close time and personal-data purge marker (CF-0044).

orders.closed_at is when the order was delivered, cancelled or flagged as a
payment mismatch. orders.details_purged_at is when the retention sweep removed
its delivery address, map pin, notes and chat. Closed orders that exist before
this revision get closed_at from delivered_at, else from ordered_at.

Revision ID: d2a6f8c4e1b7
Revises: b9e4c7a2d5f1
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2a6f8c4e1b7"
down_revision: str | Sequence[str] | None = "b9e4c7a2d5f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "orders", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "orders",
        sa.Column("details_purged_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_orders_closed_at", "orders", ["closed_at"])
    op.execute(
        "UPDATE orders SET closed_at = COALESCE(delivered_at, ordered_at) "
        "WHERE status IN ('delivered', 'cancelled', 'payment_mismatch')"
    )


def downgrade() -> None:
    op.drop_index("ix_orders_closed_at", table_name="orders")
    op.drop_column("orders", "details_purged_at")
    op.drop_column("orders", "closed_at")

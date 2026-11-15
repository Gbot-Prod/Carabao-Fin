"""Lock payout destinations (CF-0004) and add the payment_mismatch order status (CF-0005).

- payout_batches.destination_institution: the destination is now saved when a
  payout is requested, with the institution's name.
- payout_destination_changes: one audit row per code-confirmed change of a
  merchant's payout method.
- ck_orders_status allows "payment_mismatch".

Also merges the two heads open at the time (c1f6a8d3e5b7 and c5e9a2d7f4b1).
Nothing is carried over (the database was wiped).

Revision ID: f7d3b9e1c5a2
Revises: c1f6a8d3e5b7, c5e9a2d7f4b1
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f7d3b9e1c5a2"
down_revision: str | Sequence[str] | None = ("c1f6a8d3e5b7", "c5e9a2d7f4b1")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Copied on purpose: a migration must not change when the enum does.
ORDER_STATUSES = (
    "pending",
    "processing",
    "shipped",
    "out_for_delivery",
    "delivered",
    "cancelled",
)


def _orders_check(values: tuple[str, ...]) -> None:
    op.drop_constraint("ck_orders_status", "orders", type_="check")
    listed = ", ".join(f"'{v}'" for v in values)
    op.create_check_constraint("ck_orders_status", "orders", f"status IN ({listed})")


def upgrade() -> None:
    op.add_column(
        "payout_batches",
        sa.Column("destination_institution", sa.String(), nullable=True),
    )
    op.create_table(
        "payout_destination_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "merchant_id", sa.Integer(), sa.ForeignKey("merchants.id"), nullable=False
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=False),
        sa.Column("confirmed_via", sa.String(16), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_payout_destination_changes_id", "payout_destination_changes", ["id"]
    )
    op.create_index(
        "ix_payout_destination_changes_merchant_id",
        "payout_destination_changes",
        ["merchant_id"],
    )
    op.create_index(
        "ix_payout_destination_changes_created_at",
        "payout_destination_changes",
        ["created_at"],
    )
    _orders_check((*ORDER_STATUSES, "payment_mismatch"))


def downgrade() -> None:
    op.execute("UPDATE orders SET status = 'cancelled' WHERE status = 'payment_mismatch'")
    _orders_check(ORDER_STATUSES)
    op.drop_table("payout_destination_changes")
    op.drop_column("payout_batches", "destination_institution")

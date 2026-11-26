"""PayMongo refunds and the farm's side of a delivery dispute.

* transactions: paymongo_refund_id, paymongo_refund_status (processing |
  unknown | failed), refund_failure_reason. A refund sent through the
  PayMongo Refunds API stays refund_pending until PayMongo confirms it.
* orders: dispute_merchant_note, dispute_merchant_noted_at. The farm explains
  a disputed delivery for the admin who decides it.

Revision ID: e7b1d3f5a9c2
Revises: d5f7b9c1e3a4
Create Date: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e7b1d3f5a9c2"
down_revision: str | Sequence[str] | None = "d5f7b9c1e3a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "transactions", sa.Column("paymongo_refund_id", sa.String(), nullable=True)
    )
    op.add_column(
        "transactions",
        sa.Column("paymongo_refund_status", sa.String(16), nullable=True),
    )
    op.add_column(
        "transactions", sa.Column("refund_failure_reason", sa.Text(), nullable=True)
    )
    op.create_index(
        "ix_transactions_paymongo_refund_id",
        "transactions",
        ["paymongo_refund_id"],
        unique=True,
    )
    op.create_check_constraint(
        "ck_transactions_paymongo_refund_status",
        "transactions",
        "paymongo_refund_status IS NULL OR "
        "paymongo_refund_status IN ('processing', 'unknown', 'failed')",
    )
    op.add_column(
        "orders", sa.Column("dispute_merchant_note", sa.Text(), nullable=True)
    )
    op.add_column(
        "orders",
        sa.Column(
            "dispute_merchant_noted_at", sa.DateTime(timezone=True), nullable=True
        ),
    )


def downgrade() -> None:
    op.drop_column("orders", "dispute_merchant_noted_at")
    op.drop_column("orders", "dispute_merchant_note")
    op.drop_constraint(
        "ck_transactions_paymongo_refund_status", "transactions", type_="check"
    )
    op.drop_index("ix_transactions_paymongo_refund_id", table_name="transactions")
    op.drop_column("transactions", "refund_failure_reason")
    op.drop_column("transactions", "paymongo_refund_status")
    op.drop_column("transactions", "paymongo_refund_id")

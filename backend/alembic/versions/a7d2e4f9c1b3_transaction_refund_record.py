"""Record how a refund was made: method, reference, when and by which admin.

Revision ID: a7d2e4f9c1b3
Revises: c9f3a1e7b5d2
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7d2e4f9c1b3"
down_revision: str | Sequence[str] | None = "c9f3a1e7b5d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "transactions", sa.Column("refund_method", sa.String(), nullable=True)
    )
    op.add_column(
        "transactions", sa.Column("refund_reference", sa.String(), nullable=True)
    )
    op.add_column(
        "transactions",
        sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "transactions",
        sa.Column(
            "refunded_by",
            sa.Integer(),
            sa.ForeignKey(
                "backend_users.id",
                name="fk_transactions_refunded_by",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
    )
    op.add_column("transactions", sa.Column("refund_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("transactions", "refund_notes")
    op.drop_constraint(
        "fk_transactions_refunded_by", "transactions", type_="foreignkey"
    )
    op.drop_column("transactions", "refunded_by")
    op.drop_column("transactions", "refunded_at")
    op.drop_column("transactions", "refund_reference")
    op.drop_column("transactions", "refund_method")

"""Let admins hide a produce listing with a reason the merchant can see.

Revision ID: d8a3b6c2e5f4
Revises: c2e7f1a9d4b6
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d8a3b6c2e5f4"
down_revision: str | Sequence[str] | None = "c2e7f1a9d4b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "produces", sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index("ix_produces_hidden_at", "produces", ["hidden_at"])
    op.add_column("produces", sa.Column("hidden_reason", sa.Text(), nullable=True))
    op.add_column(
        "produces",
        sa.Column(
            "hidden_by",
            sa.Integer(),
            sa.ForeignKey(
                "backend_users.id", name="fk_produces_hidden_by", ondelete="SET NULL"
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint("fk_produces_hidden_by", "produces", type_="foreignkey")
    op.drop_column("produces", "hidden_by")
    op.drop_column("produces", "hidden_reason")
    op.drop_index("ix_produces_hidden_at", table_name="produces")
    op.drop_column("produces", "hidden_at")

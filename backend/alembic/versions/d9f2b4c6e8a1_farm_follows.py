"""Buyers can follow farms (U4).

Revision ID: d9f2b4c6e8a1
Revises: c7e1a3f5b9d2
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d9f2b4c6e8a1"
down_revision: str | Sequence[str] | None = "c7e1a3f5b9d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "farm_follows",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "merchant_id",
            sa.Integer(),
            sa.ForeignKey("merchants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id", "merchant_id", name="uq_farm_follows_user_merchant"
        ),
    )
    for column in ("id", "user_id", "merchant_id"):
        op.create_index(f"ix_farm_follows_{column}", "farm_follows", [column])


def downgrade() -> None:
    for column in ("merchant_id", "user_id", "id"):
        op.drop_index(f"ix_farm_follows_{column}", table_name="farm_follows")
    op.drop_table("farm_follows")

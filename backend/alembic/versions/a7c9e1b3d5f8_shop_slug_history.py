"""Shop slug history: old /farms/<slug> links redirect to the current slug.

Revision ID: a7c9e1b3d5f8
Revises: c4e6a8b0d2f4
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c9e1b3d5f8"
down_revision: str | Sequence[str] | None = "c4e6a8b0d2f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shop_slug_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column(
            "merchant_id",
            sa.Integer(),
            sa.ForeignKey("merchants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_shop_slug_history_slug", "shop_slug_history", ["slug"], unique=True
    )
    op.create_index(
        "ix_shop_slug_history_merchant_id", "shop_slug_history", ["merchant_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_shop_slug_history_merchant_id", table_name="shop_slug_history")
    op.drop_index("ix_shop_slug_history_slug", table_name="shop_slug_history")
    op.drop_table("shop_slug_history")

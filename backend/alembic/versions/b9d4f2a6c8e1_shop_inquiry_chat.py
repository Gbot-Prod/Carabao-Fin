"""Shop inquiries: a buyer can message a farm before buying.

Revision ID: b9d4f2a6c8e1
Revises: d3a7c1e5f9b2
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b9d4f2a6c8e1"
down_revision: str | Sequence[str] | None = "d3a7c1e5f9b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "merchant_id",
            sa.Integer(),
            sa.ForeignKey(
                "merchants.id",
                ondelete="CASCADE",
                name="fk_conversations_merchant_id",
            ),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_conversations_merchant_id", "conversations", ["merchant_id"]
    )
    op.create_unique_constraint(
        "uq_conversations_shop", "conversations", ["kind", "user_id", "merchant_id"]
    )


def downgrade() -> None:
    op.execute("DELETE FROM conversations WHERE kind = 'shop'")
    op.drop_constraint("uq_conversations_shop", "conversations", type_="unique")
    op.drop_index("ix_conversations_merchant_id", table_name="conversations")
    op.drop_constraint(
        "fk_conversations_merchant_id", "conversations", type_="foreignkey"
    )
    op.drop_column("conversations", "merchant_id")

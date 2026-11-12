"""Buyer reviews of merchants, one per delivered order.

Revision ID: f2c6a9d4b8e1
Revises: e5b9d3a7c2f1
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f2c6a9d4b8e1"
down_revision: str | Sequence[str] | None = "e5b9d3a7c2f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create reviews and add the cached review count to merchants."""
    bind = op.get_bind()
    inspector = inspect(bind)

    merchant_columns = {c["name"] for c in inspector.get_columns("merchants")}
    if "rating_count" not in merchant_columns:
        op.add_column(
            "merchants",
            sa.Column("rating_count", sa.Integer(), nullable=False, server_default="0"),
        )

    if not inspector.has_table("reviews"):
        op.create_table(
            "reviews",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "order_id",
                sa.Integer(),
                sa.ForeignKey("orders.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("backend_users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "merchant_id",
                sa.Integer(),
                sa.ForeignKey("merchants.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("rating", sa.SmallInteger(), nullable=False),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
            sa.CheckConstraint(
                "rating BETWEEN 1 AND 5", name="ck_reviews_rating_range"
            ),
            sa.UniqueConstraint("order_id", name="uq_reviews_order_id"),
        )
        op.create_index("ix_reviews_id", "reviews", ["id"])
        op.create_index("ix_reviews_user_id", "reviews", ["user_id"])
        op.create_index("ix_reviews_merchant_id", "reviews", ["merchant_id"])


def downgrade() -> None:
    """Drop reviews and the cached review count."""
    bind = op.get_bind()
    inspector = inspect(bind)

    if inspector.has_table("reviews"):
        op.drop_index("ix_reviews_merchant_id", table_name="reviews")
        op.drop_index("ix_reviews_user_id", table_name="reviews")
        op.drop_index("ix_reviews_id", table_name="reviews")
        op.drop_table("reviews")

    merchant_columns = {c["name"] for c in inspector.get_columns("merchants")}
    if "rating_count" in merchant_columns:
        op.drop_column("merchants", "rating_count")

"""Admins hide abusive or fake reviews (CF-0075).

Revision ID: e3a5c7e9b1d4
Revises: d1f3a5c7e9b2
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3a5c7e9b1d4"
down_revision: str | Sequence[str] | None = "d1f3a5c7e9b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable, no default: adding them does not rewrite the table.
    op.add_column(
        "reviews", sa.Column("hidden_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("reviews", sa.Column("hidden_reason", sa.String(500), nullable=True))
    op.add_column(
        "reviews",
        sa.Column(
            "hidden_by",
            sa.Integer(),
            sa.ForeignKey(
                "backend_users.id",
                name="fk_reviews_hidden_by_backend_users",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
    )
    op.create_index("ix_reviews_hidden_at", "reviews", ["hidden_at"])


def downgrade() -> None:
    op.drop_index("ix_reviews_hidden_at", table_name="reviews")
    op.drop_column("reviews", "hidden_by")
    op.drop_column("reviews", "hidden_reason")
    op.drop_column("reviews", "hidden_at")

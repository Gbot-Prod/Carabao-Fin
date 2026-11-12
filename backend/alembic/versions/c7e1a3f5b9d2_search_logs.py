"""Log produce searches (no user id) for demand insight (U2, F3).

Revision ID: c7e1a3f5b9d2
Revises: b2d6f8a4c9e1
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7e1a3f5b9d2"
down_revision: str | Sequence[str] | None = "b2d6f8a4c9e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "search_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("query", sa.String(100), nullable=False),
        sa.Column("province", sa.String(), nullable=True),
        sa.Column("result_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    for column in ("id", "query", "province", "created_at"):
        op.create_index(f"ix_search_logs_{column}", "search_logs", [column])


def downgrade() -> None:
    for column in ("created_at", "province", "query", "id"):
        op.drop_index(f"ix_search_logs_{column}", table_name="search_logs")
    op.drop_table("search_logs")

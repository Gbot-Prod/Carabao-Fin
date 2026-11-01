"""Soft-delete merchants instead of removing their financial records.

Revision ID: c4a8e2f1d9b3
Revises: b7e3c1d9a420
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4a8e2f1d9b3"
down_revision: str | Sequence[str] | None = "b7e3c1d9a420"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add merchants.deleted_at."""
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("merchants")}

    if "deleted_at" not in columns:
        op.add_column(
            "merchants",
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_merchants_deleted_at", "merchants", ["deleted_at"])


def downgrade() -> None:
    """Remove merchants.deleted_at.

    Soft-deleted merchants become visible again; their records were never
    removed, so nothing else needs restoring.
    """
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("merchants")}
    if "deleted_at" in columns:
        op.drop_index("ix_merchants_deleted_at", table_name="merchants")
        op.drop_column("merchants", "deleted_at")

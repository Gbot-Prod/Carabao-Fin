"""Restore the required merchant application province column.

Revision ID: 9d4e7f2a6c31
Revises: 8c2d4e6f91ab
Create Date: 2026-10-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = "9d4e7f2a6c31"
down_revision: str | Sequence[str] | None = "8c2d4e6f91ab"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Restore province and enforce the model's required constraint."""
    bind = op.get_bind()
    columns = {
        column["name"] for column in inspect(bind).get_columns("merchant_applications")
    }

    if "province" not in columns:
        op.add_column(
            "merchant_applications",
            sa.Column("province", sa.String(), nullable=True),
        )

    has_rows_without_province = bind.execute(
        sa.text(
            "SELECT EXISTS ("
            "SELECT 1 FROM merchant_applications "
            "WHERE province IS NULL"
            ")"
        )
    ).scalar()
    if has_rows_without_province:
        raise RuntimeError(
            "merchant_applications contains rows without province. "
            "Backfill province values, then rerun this migration."
        )

    op.alter_column(
        "merchant_applications",
        "province",
        existing_type=sa.String(),
        nullable=False,
    )


def downgrade() -> None:
    """Remove the restored province column."""
    bind = op.get_bind()
    columns = {
        column["name"] for column in inspect(bind).get_columns("merchant_applications")
    }
    if "province" in columns:
        op.drop_column("merchant_applications", "province")

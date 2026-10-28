"""Repair missing merchant application location columns.

Revision ID: 8c2d4e6f91ab
Revises: 35f7bf81bda5
Create Date: 2026-10-27

The database was stamped at 35f7bf81bda5 even though its
merchant_applications table did not receive province and barangay.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c2d4e6f91ab"
down_revision: str | Sequence[str] | None = "35f7bf81bda5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the location columns missing from merchant_applications."""
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

    if "barangay" not in columns:
        op.add_column(
            "merchant_applications",
            sa.Column("barangay", sa.String(), nullable=True),
        )


def downgrade() -> None:
    """Remove the repaired location columns."""
    bind = op.get_bind()
    columns = {
        column["name"] for column in inspect(bind).get_columns("merchant_applications")
    }

    if "barangay" in columns:
        op.drop_column("merchant_applications", "barangay")
    if "province" in columns:
        op.drop_column("merchant_applications", "province")

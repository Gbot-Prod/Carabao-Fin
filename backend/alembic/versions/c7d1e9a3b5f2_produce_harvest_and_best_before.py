"""Store each produce listing's harvest and best-before dates.

Revision ID: c7d1e9a3b5f2
Revises: b8e4f2a6c1d3
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c7d1e9a3b5f2"
down_revision: str | Sequence[str] | None = "b8e4f2a6c1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add nullable date columns; existing listings keep NULL and stay listed."""
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("produces")}

    if "harvest_date" not in columns:
        op.add_column("produces", sa.Column("harvest_date", sa.Date(), nullable=True))
    if "best_before" not in columns:
        op.add_column("produces", sa.Column("best_before", sa.Date(), nullable=True))
        op.create_index("ix_produces_best_before", "produces", ["best_before"])


def downgrade() -> None:
    """Remove the date columns."""
    bind = op.get_bind()
    columns = {column["name"] for column in inspect(bind).get_columns("produces")}
    if "best_before" in columns:
        op.drop_index("ix_produces_best_before", table_name="produces")
        op.drop_column("produces", "best_before")
    if "harvest_date" in columns:
        op.drop_column("produces", "harvest_date")

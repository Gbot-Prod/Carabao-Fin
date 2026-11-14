"""Drop price_range_min/max from merchants and merchant_applications.

A shop's price range was typed in at onboarding and shown on shop cards. It
was not kept in step with the real listing prices, so it is removed. Nothing
is carried over (the database was wiped). Downgrade brings the columns back,
nullable and empty.

Revision ID: a7c3e9f1b5d2
Revises: d4f1b8e2a6c3
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a7c3e9f1b5d2"
down_revision: str | Sequence[str] | None = "d4f1b8e2a6c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("merchants", "merchant_applications")
COLUMNS = ("price_range_min", "price_range_max")


def upgrade() -> None:
    for table in TABLES:
        for column in COLUMNS:
            op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS {column}")


def downgrade() -> None:
    for table in TABLES:
        for column in COLUMNS:
            op.add_column(table, sa.Column(column, sa.Integer(), nullable=True))

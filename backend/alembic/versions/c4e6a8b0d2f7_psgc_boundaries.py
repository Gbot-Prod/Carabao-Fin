"""PSGC boundary polygons and the pin-area flag.

* psgc_boundaries: Luzon city/municipality and barangay polygons (WKB), keyed
  by PSGC code. Load the rows with
  ``uv run python scripts/load_psgc_boundaries.py``. Until then the pin-area
  check does not run (pin_area_mismatch stays NULL); saves still work.
* pin_area_mismatch on user_addresses, merchants and merchant_applications.
  No backfill: the DB holds no legacy addresses.

No PostGIS: the Railway image (postgres-ssl:17) does not have it. The polygon
test runs in Python (services/pin_area.py).

Revision ID: c4e6a8b0d2f7
Revises: b6d8f0a2c4e7
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4e6a8b0d2f7"
down_revision: str | Sequence[str] | None = "b6d8f0a2c4e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("user_addresses", "merchants", "merchant_applications")


def upgrade() -> None:
    op.create_table(
        "psgc_boundaries",
        sa.Column("code", sa.String(10), primary_key=True),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("min_lat", sa.Float(), nullable=False),
        sa.Column("min_lng", sa.Float(), nullable=False),
        sa.Column("max_lat", sa.Float(), nullable=False),
        sa.Column("max_lng", sa.Float(), nullable=False),
        sa.Column("geometry", sa.LargeBinary(), nullable=False),
        sa.CheckConstraint(
            "level IN ('city', 'barangay')", name="ck_psgc_boundaries_level"
        ),
    )
    op.create_index(
        "ix_psgc_boundaries_level_lat",
        "psgc_boundaries",
        ["level", "min_lat", "max_lat"],
    )
    for table in TABLES:
        op.add_column(
            table, sa.Column("pin_area_mismatch", sa.Boolean(), nullable=True)
        )


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "pin_area_mismatch")
    op.drop_index("ix_psgc_boundaries_level_lat", table_name="psgc_boundaries")
    op.drop_table("psgc_boundaries")

"""PSGC reference table and address codes.

* psgc_areas: regions, provinces, cities/municipalities and barangays. Load the
  rows with ``uv run python scripts/load_psgc.py`` (address saves answer 503
  until then).
* region_code, province_code, city_code, barangay_code on user_addresses,
  merchants and merchant_applications. No backfill: the DB holds no legacy
  addresses.

Revision ID: e9c3a5b7d1f2
Revises: d8e2f4a6b1c3
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e9c3a5b7d1f2"
down_revision: str | Sequence[str] | None = "d8e2f4a6b1c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("user_addresses", "merchants", "merchant_applications")
CODES = ("region_code", "province_code", "city_code", "barangay_code")


def upgrade() -> None:
    op.create_table(
        "psgc_areas",
        sa.Column("code", sa.String(10), primary_key=True),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("name_key", sa.String(150), nullable=False),
        sa.Column("parent_code", sa.String(10), nullable=True),
        sa.Column("region_code", sa.String(10), nullable=False),
        sa.Column("city_type", sa.String(10), nullable=True),
        sa.Column("postal_code", sa.String(4), nullable=True),
        sa.CheckConstraint(
            "level IN ('region', 'province', 'city', 'barangay')",
            name="ck_psgc_areas_level",
        ),
    )
    op.create_index(
        "ix_psgc_areas_parent_name", "psgc_areas", ["parent_code", "name_key"]
    )
    op.create_index("ix_psgc_areas_level_name", "psgc_areas", ["level", "name_key"])

    for table in TABLES:
        for column in CODES:
            op.add_column(table, sa.Column(column, sa.String(10), nullable=True))
        op.create_index(f"ix_{table}_city_code", table, ["city_code"])


def downgrade() -> None:
    for table in TABLES:
        op.drop_index(f"ix_{table}_city_code", table_name=table)
        for column in reversed(CODES):
            op.drop_column(table, column)
    op.drop_index("ix_psgc_areas_level_name", table_name="psgc_areas")
    op.drop_index("ix_psgc_areas_parent_name", table_name="psgc_areas")
    op.drop_table("psgc_areas")

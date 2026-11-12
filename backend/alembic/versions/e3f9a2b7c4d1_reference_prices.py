"""Market reference price ranges shown next to listings (P1).

Revision ID: e3f9a2b7c4d1
Revises: d8a3b6c2e5f4
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3f9a2b7c4d1"
down_revision: str | Sequence[str] | None = "d8a3b6c2e5f4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reference_prices",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("commodity", sa.String(), nullable=False),
        sa.Column("aliases", sa.String(), nullable=False, server_default=""),
        sa.Column("unit", sa.String(), nullable=False, server_default="kg"),
        sa.Column("low", sa.Integer(), nullable=False),
        sa.Column("high", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.UniqueConstraint(
            "commodity", "unit", name="uq_reference_prices_commodity_unit"
        ),
    )
    op.create_index("ix_reference_prices_id", "reference_prices", ["id"])
    op.create_index("ix_reference_prices_commodity", "reference_prices", ["commodity"])


def downgrade() -> None:
    op.drop_index("ix_reference_prices_commodity", table_name="reference_prices")
    op.drop_index("ix_reference_prices_id", table_name="reference_prices")
    op.drop_table("reference_prices")

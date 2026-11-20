"""Pin quality: road point next to each pin, unreachable-pin reports.

Control 2: ``road_lat`` / ``road_lng`` (``delivery_road_*`` on orders) hold the
nearest road point to the pin; routing uses it. Control 6: a rider can report
an order's pin as unreachable (``pin_unreachable_at`` / ``_note``).

Revision ID: a8c2e4f6b1d3
Revises: f5b7d9e1a3c6
Create Date: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8c2e4f6b1d3"
down_revision: str | Sequence[str] | None = "f5b7d9e1a3c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ROAD_TABLES = ("user_addresses", "merchants", "merchant_applications")


def upgrade() -> None:
    for table in _ROAD_TABLES:
        op.add_column(table, sa.Column("road_lat", sa.Float(), nullable=True))
        op.add_column(table, sa.Column("road_lng", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("delivery_road_lat", sa.Float(), nullable=True))
    op.add_column("orders", sa.Column("delivery_road_lng", sa.Float(), nullable=True))
    op.add_column(
        "orders",
        sa.Column("pin_unreachable_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "orders", sa.Column("pin_unreachable_note", sa.String(200), nullable=True)
    )


def downgrade() -> None:
    for column in (
        "pin_unreachable_note",
        "pin_unreachable_at",
        "delivery_road_lng",
        "delivery_road_lat",
    ):
        op.drop_column("orders", column)
    for table in reversed(_ROAD_TABLES):
        op.drop_column(table, "road_lng")
        op.drop_column(table, "road_lat")

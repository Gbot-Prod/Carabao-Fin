"""Verified pins: user_addresses.pin_verified_at.

The server sets it when a delivery to the pin finished and no rider reported
the pin (services/pinned_location.py mark_pin_verified). Moving the pin clears
it. No backfill: the DB holds no legacy addresses.

Pins that the road check did not examine (road service outage) need no
column: they are the rows with a pin and no road_lat.

Revision ID: f8a2c4e6b0d9
Revises: c4e6a8b0d2f7
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f8a2c4e6b0d9"
down_revision: str | Sequence[str] | None = "c4e6a8b0d2f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_addresses",
        sa.Column("pin_verified_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_addresses", "pin_verified_at")

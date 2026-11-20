"""Pin confirmed: did the person place the map pin, or is it only geocoded?

The web forms now place the first pin from the typed address; the person then
drags it to their gate. ``pin_confirmed`` (``delivery_pin_confirmed`` on
orders) is true once they placed or moved it themselves, so riders can treat
an unconfirmed pin as approximate. Pins saved before this were always placed
by hand, so existing pins are marked confirmed.

Revision ID: c6e2a8f4d1b9
Revises: a8c2e4f6b1d3
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c6e2a8f4d1b9"
down_revision: str | Sequence[str] | None = "a8c2e4f6b1d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, flag column, latitude column)
_COLUMNS = (
    ("user_addresses", "pin_confirmed", "lat"),
    ("merchants", "pin_confirmed", "lat"),
    ("merchant_applications", "pin_confirmed", "lat"),
    ("orders", "delivery_pin_confirmed", "delivery_lat"),
)


def upgrade() -> None:
    for table, column, lat in _COLUMNS:
        op.add_column(
            table,
            sa.Column(
                column, sa.Boolean(), nullable=False, server_default=sa.text("false")
            ),
        )
        op.execute(f"UPDATE {table} SET {column} = true WHERE {lat} IS NOT NULL")


def downgrade() -> None:
    for table, column, _ in reversed(_COLUMNS):
        op.drop_column(table, column)

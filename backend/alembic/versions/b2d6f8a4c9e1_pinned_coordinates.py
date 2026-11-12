"""Map-pinned coordinates for profiles, merchants, applications and orders (U1).

Revision ID: b2d6f8a4c9e1
Revises: a1c9e5f3b7d8
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2d6f8a4c9e1"
down_revision: str | Sequence[str] | None = "a1c9e5f3b7d8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = [
    ("backend_users", "lat"),
    ("backend_users", "lng"),
    ("merchants", "lat"),
    ("merchants", "lng"),
    ("merchant_applications", "lat"),
    ("merchant_applications", "lng"),
    ("orders", "delivery_lat"),
    ("orders", "delivery_lng"),
]


def upgrade() -> None:
    for table, column in COLUMNS:
        op.add_column(table, sa.Column(column, sa.Float(), nullable=True))


def downgrade() -> None:
    for table, column in reversed(COLUMNS):
        op.drop_column(table, column)

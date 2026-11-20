"""Notifications: which side of the account they are for.

A user can be a buyer and a farm owner. ``audience`` ("buyer", "merchant",
"admin") lets the buyer site and the merchant site each show only their own
notifications. Existing rows are sorted by link, the same rule as
``services.notifications.audience_for``: ``/merchantDashboard...`` is merchant,
``/admin...`` is admin, the rest buyer.

Revision ID: c4e6a8b0d2f4
Revises: e2c8a4f6d0b3
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e6a8b0d2f4"
down_revision: str | Sequence[str] | None = "e2c8a4f6d0b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Kept as constants so tests can run the backfill against old rows.
BACKFILL = (
    "UPDATE notifications SET audience = 'merchant' "
    "WHERE link = '/merchantDashboard' OR link LIKE '/merchantDashboard?%' "
    "OR link LIKE '/merchantDashboard/%'",
    "UPDATE notifications SET audience = 'admin' "
    "WHERE link = '/admin' OR link LIKE '/admin/%' OR link LIKE '/admin?%'",
)


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("audience", sa.String(10), nullable=False, server_default="buyer"),
    )
    for sql in BACKFILL:
        op.execute(sql)
    op.create_index("ix_notifications_audience", "notifications", ["audience"])


def downgrade() -> None:
    op.drop_index("ix_notifications_audience", table_name="notifications")
    op.drop_column("notifications", "audience")

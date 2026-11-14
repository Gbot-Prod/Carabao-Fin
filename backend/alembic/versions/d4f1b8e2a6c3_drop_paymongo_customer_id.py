"""Drop backend_users.paymongo_customer_id: saved cards are removed.

Card saving (PayMongo customers + attached payment methods) was never
launched; the routes, service calls and profile panel are gone with this
revision. Nothing is carried over (the database was wiped). Downgrade brings
the column back empty.

Revision ID: d4f1b8e2a6c3
Revises: c3e8a1f5d7b9
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d4f1b8e2a6c3"
down_revision: str | Sequence[str] | None = "c3e8a1f5d7b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Dropping a column drops its index and unique constraint too.
    op.drop_index(
        "ix_backend_users_paymongo_customer_id",
        table_name="backend_users",
        if_exists=True,
    )
    op.execute("ALTER TABLE backend_users DROP COLUMN IF EXISTS paymongo_customer_id")


def downgrade() -> None:
    op.add_column(
        "backend_users",
        sa.Column("paymongo_customer_id", sa.String(), nullable=True),
    )
    op.create_index(
        "ix_backend_users_paymongo_customer_id",
        "backend_users",
        ["paymongo_customer_id"],
        unique=True,
    )

"""Saved addresses: recipient name and phone.

Who receives deliveries at the address and a PH mobile number the rider can
call, as on the address forms. Optional: older addresses and the mobile app
have neither.

Revision ID: d3a7c1e5f9b2
Revises: c6e2a8f4d1b9
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d3a7c1e5f9b2"
down_revision: str | Sequence[str] | None = "c6e2a8f4d1b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "user_addresses", sa.Column("recipient_name", sa.String(100), nullable=True)
    )
    op.add_column(
        "user_addresses", sa.Column("recipient_phone", sa.String(20), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("user_addresses", "recipient_phone")
    op.drop_column("user_addresses", "recipient_name")

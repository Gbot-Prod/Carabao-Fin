"""Address change log (pin quality, item 3).

One row per change to the pin or the PSGC area of a saved address or a shop
(services/address_log.py). No coordinates and no address text. Rows older
than 180 days are deleted in the cleanup loop.

Revision ID: a9d3f5b7c1e8
Revises: f8a2c4e6b0d9
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a9d3f5b7c1e8"
down_revision: str | Sequence[str] | None = "f8a2c4e6b0d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "address_change_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(10), nullable=False),
        sa.Column("old_city_code", sa.String(10), nullable=True),
        sa.Column("new_city_code", sa.String(10), nullable=True),
        sa.Column("old_barangay_code", sa.String(10), nullable=True),
        sa.Column("new_barangay_code", sa.String(10), nullable=True),
        sa.Column("pin_change", sa.String(10), nullable=True),
        sa.Column("pin_moved_m", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_address_change_logs_id", "address_change_logs", ["id"])
    op.create_index(
        "ix_address_change_logs_user_id", "address_change_logs", ["user_id"]
    )
    op.create_index(
        "ix_address_change_logs_created_at", "address_change_logs", ["created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_address_change_logs_created_at", "address_change_logs")
    op.drop_index("ix_address_change_logs_user_id", "address_change_logs")
    op.drop_index("ix_address_change_logs_id", "address_change_logs")
    op.drop_table("address_change_logs")

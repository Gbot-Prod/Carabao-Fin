"""Buyers can save produce listings for later (wishlist, CF-0038).

Revision ID: e4a8c2f6b0d3
Revises: dce435b8fceb
Create Date: 2026-11-18
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4a8c2f6b0d3"
down_revision: str | Sequence[str] | None = "dce435b8fceb"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "saved_produce",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "produce_id",
            sa.Integer(),
            sa.ForeignKey("produces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "user_id", "produce_id", name="uq_saved_produce_user_produce"
        ),
    )
    for column in ("id", "user_id", "produce_id"):
        op.create_index(f"ix_saved_produce_{column}", "saved_produce", [column])


def downgrade() -> None:
    for column in ("produce_id", "user_id", "id"):
        op.drop_index(f"ix_saved_produce_{column}", table_name="saved_produce")
    op.drop_table("saved_produce")

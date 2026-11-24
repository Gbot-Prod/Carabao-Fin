"""Produce guardrails Phase 3: buyer reports on listings.

* listing_reports: one row per buyer report (services/listing_reports.py).
  An open report sends the listing to the admin review queue.

Revision ID: b6d8f0a2c4e7
Revises: a4c6e8f0b2d5
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b6d8f0a2c4e7"
down_revision: str | Sequence[str] | None = "a4c6e8f0b2d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "listing_reports",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "produce_id",
            sa.Integer(),
            sa.ForeignKey("produces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "reporter_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reason", sa.String(40), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column(
            "resolved_by",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="SET NULL"),
        ),
        sa.Column("resolution", sa.String(16)),
    )
    op.create_index(op.f("ix_listing_reports_id"), "listing_reports", ["id"])
    op.create_index(
        op.f("ix_listing_reports_produce_id"), "listing_reports", ["produce_id"]
    )
    op.create_index(
        "uq_listing_reports_open",
        "listing_reports",
        ["produce_id", "reporter_id"],
        unique=True,
        postgresql_where=sa.text("resolved_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_listing_reports_open", table_name="listing_reports")
    op.drop_index(op.f("ix_listing_reports_produce_id"), table_name="listing_reports")
    op.drop_index(op.f("ix_listing_reports_id"), table_name="listing_reports")
    op.drop_table("listing_reports")

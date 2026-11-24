"""Produce guardrails Phase 2: penalty points and listing approval date.

* listing_penalties: points for confirmed violations (services/listing_trust.py).
* produces.approved_at: the first time an admin approved the listing. A new
  merchant's listings go to under_review until 3 listings have it.

Revision ID: a4c6e8f0b2d5
Revises: e9c3a5b7d1f2
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a4c6e8f0b2d5"
down_revision: str | Sequence[str] | None = "e9c3a5b7d1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("produces", sa.Column("approved_at", sa.DateTime(timezone=True)))
    op.create_table(
        "listing_penalties",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "merchant_id",
            sa.Integer(),
            sa.ForeignKey("merchants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "produce_id",
            sa.Integer(),
            sa.ForeignKey("produces.id", ondelete="SET NULL"),
        ),
        sa.Column("produce_name", sa.String(), nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="SET NULL"),
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
        sa.Column(
            "revoked_by",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="SET NULL"),
        ),
        sa.Column("revoke_reason", sa.Text()),
    )
    op.create_index(op.f("ix_listing_penalties_id"), "listing_penalties", ["id"])
    op.create_index(
        "ix_listing_penalties_merchant_created",
        "listing_penalties",
        ["merchant_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_listing_penalties_merchant_created", table_name="listing_penalties"
    )
    op.drop_index(op.f("ix_listing_penalties_id"), table_name="listing_penalties")
    op.drop_table("listing_penalties")
    op.drop_column("produces", "approved_at")

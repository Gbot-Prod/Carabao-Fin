"""Produce guardrails Phase 1: listing status, review fields, prohibited terms.

* produces.status (live | under_review | rejected | hidden), review_flags,
  submitted_for_review_at, reviewed_at, reviewed_by, rejection_code,
  rejection_reason. Backfill: hidden listings get ``hidden``, all others
  ``live``.
* prohibited_terms: the word list the listing checker uses. Load the first
  rows with ``uv run python scripts/load_prohibited_terms.py``.

Revision ID: d8e2f4a6b1c3
Revises: c3d5e7f9a1b4
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d8e2f4a6b1c3"
down_revision: str | Sequence[str] | None = "c3d5e7f9a1b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = ("live", "under_review", "rejected", "hidden")


def upgrade() -> None:
    allowed = ", ".join(f"'{status}'" for status in STATUSES)
    op.add_column(
        "produces",
        sa.Column("status", sa.String(32), nullable=False, server_default="live"),
    )
    op.create_check_constraint(
        "ck_produces_status", "produces", f"status IN ({allowed})"
    )
    op.create_index(op.f("ix_produces_status"), "produces", ["status"])
    op.add_column(
        "produces",
        sa.Column(
            "review_flags",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )
    for column in (
        sa.Column("submitted_for_review_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column(
            "reviewed_by",
            sa.Integer(),
            sa.ForeignKey(
                "backend_users.id",
                ondelete="SET NULL",
                name="fk_produces_reviewed_by_backend_users",
            ),
        ),
        sa.Column("rejection_code", sa.String(40)),
        sa.Column("rejection_reason", sa.Text()),
    ):
        op.add_column("produces", column)
    op.execute("UPDATE produces SET status = 'hidden' WHERE hidden_at IS NOT NULL")

    op.create_table(
        "prohibited_terms",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("term", sa.String(120), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column(
            "severity", sa.String(20), nullable=False, server_default="hard_block"
        ),
        sa.Column("language", sa.String(10), nullable=False, server_default="all"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("term", name="uq_prohibited_terms_term"),
    )
    op.create_index(op.f("ix_prohibited_terms_id"), "prohibited_terms", ["id"])
    op.create_index(
        "ix_prohibited_terms_active_category",
        "prohibited_terms",
        ["is_active", "category"],
    )


def downgrade() -> None:
    op.drop_index("ix_prohibited_terms_active_category", table_name="prohibited_terms")
    op.drop_index(op.f("ix_prohibited_terms_id"), table_name="prohibited_terms")
    op.drop_table("prohibited_terms")
    for name in (
        "rejection_reason",
        "rejection_code",
        "reviewed_by",
        "reviewed_at",
        "submitted_for_review_at",
        "review_flags",
    ):
        op.drop_column("produces", name)
    op.drop_index(op.f("ix_produces_status"), table_name="produces")
    op.drop_constraint("ck_produces_status", "produces", type_="check")
    op.drop_column("produces", "status")

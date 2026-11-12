"""Append-only log of admin actions with before and after values.

Revision ID: c2e7f1a9d4b6
Revises: b5c1d8e3f7a2
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c2e7f1a9d4b6"
down_revision: str | Sequence[str] | None = "b5c1d8e3f7a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "admin_audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "admin_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("admin_email", sa.String(), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=False),
        sa.Column("target_id", sa.Integer(), nullable=True),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    for column in ("id", "admin_id", "action", "target_id", "created_at"):
        op.create_index(f"ix_admin_audit_logs_{column}", "admin_audit_logs", [column])


def downgrade() -> None:
    for column in ("created_at", "target_id", "action", "admin_id", "id"):
        op.drop_index(f"ix_admin_audit_logs_{column}", table_name="admin_audit_logs")
    op.drop_table("admin_audit_logs")

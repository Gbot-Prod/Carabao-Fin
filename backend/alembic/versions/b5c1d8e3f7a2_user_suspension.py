"""Let admins suspend accounts: when, why, and by whom.

Revision ID: b5c1d8e3f7a2
Revises: a7d2e4f9c1b3
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b5c1d8e3f7a2"
down_revision: str | Sequence[str] | None = "a7d2e4f9c1b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "backend_users",
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_backend_users_suspended_at", "backend_users", ["suspended_at"])
    op.add_column(
        "backend_users", sa.Column("suspension_reason", sa.Text(), nullable=True)
    )
    op.add_column(
        "backend_users",
        sa.Column(
            "suspended_by",
            sa.Integer(),
            sa.ForeignKey(
                "backend_users.id",
                name="fk_backend_users_suspended_by",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_backend_users_suspended_by", "backend_users", type_="foreignkey"
    )
    op.drop_column("backend_users", "suspended_by")
    op.drop_column("backend_users", "suspension_reason")
    op.drop_index("ix_backend_users_suspended_at", table_name="backend_users")
    op.drop_column("backend_users", "suspended_at")

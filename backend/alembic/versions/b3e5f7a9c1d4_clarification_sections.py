"""Clarification sections on merchant applications.

* merchant_applications.clarification_sections: the parts of the application
  an admin flagged with a clarification request (JSON list). The applicant
  changes only these; the other parts stay as sent.

Revision ID: b3e5f7a9c1d4
Revises: e9a1c3b5d7f2
Create Date: 2026-11-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b3e5f7a9c1d4"
down_revision: str | Sequence[str] | None = "e9a1c3b5d7f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "merchant_applications",
        sa.Column("clarification_sections", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("merchant_applications", "clarification_sections")

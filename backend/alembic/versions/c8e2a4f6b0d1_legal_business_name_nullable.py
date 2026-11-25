"""Repair legal_business_name: nullable on merchants and merchant_applications.

Revision ID: c8e2a4f6b0d1
Revises: b3e5f7a9c1d4
Create Date: 2026-11-25

The models and earlier migrations have this column nullable, but a deployed
database had NOT NULL. A Submit later application has no legal name yet, so
the first onboarding save failed. DROP NOT NULL has no effect on a column
that is already nullable.
"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c8e2a4f6b0d1"
down_revision: str | Sequence[str] | None = "b3e5f7a9c1d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("merchants", "merchant_applications")


def upgrade() -> None:
    for table in _TABLES:
        op.alter_column(table, "legal_business_name", nullable=True)


def downgrade() -> None:
    # The nullable column is the intended schema; nothing to restore.
    pass

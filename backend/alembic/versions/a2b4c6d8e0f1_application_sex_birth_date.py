"""Merchant applications: sex and birth date of an individual seller.

Revision ID: a2b4c6d8e0f1
Revises: e1c3a5b7d9f2
Create Date: 2026-11-26

As on the government ID. The admin uses them with the name in the DA RSBSA
Finder. birth_date is encrypted (EncryptedString), so it is Text.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a2b4c6d8e0f1"
down_revision: str | Sequence[str] | None = "e1c3a5b7d9f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("merchant_applications", sa.Column("sex", sa.String(10), nullable=True))
    op.add_column("merchant_applications", sa.Column("birth_date", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("merchant_applications", "birth_date")
    op.drop_column("merchant_applications", "sex")

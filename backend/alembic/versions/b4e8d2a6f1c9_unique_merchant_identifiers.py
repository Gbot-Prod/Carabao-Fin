"""One account per TIN / RSBSA number, enforced by the database (CF-0028).

- merchants: unique tin_hmac and rsbsa_number_hmac where deleted_at IS NULL.
- merchant_applications: unique tin_hmac and rsbsa_number_hmac (NULLs allowed).

The onboarding route also takes an advisory lock on each hash; these indexes
are the last guard. Nothing is carried over (the database was wiped).

Revision ID: b4e8d2a6f1c9
Revises: f7d3b9e1c5a2
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b4e8d2a6f1c9"
down_revision: str | Sequence[str] | None = "f7d3b9e1c5a2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COLUMNS = ("tin_hmac", "rsbsa_number_hmac")


def upgrade() -> None:
    for column in COLUMNS:
        op.create_index(
            f"uq_merchants_{column}_live",
            "merchants",
            [column],
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
        )
        op.create_index(
            f"uq_merchant_applications_{column}",
            "merchant_applications",
            [column],
            unique=True,
            postgresql_where=sa.text(f"{column} IS NOT NULL"),
        )


def downgrade() -> None:
    for column in COLUMNS:
        op.drop_index(f"uq_merchant_applications_{column}", "merchant_applications")
        op.drop_index(f"uq_merchants_{column}_live", "merchants")

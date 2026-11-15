"""Keep the number before the last change (CF-0019).

- BetterAuth "user": "previousPhoneNumber", "phoneNumberChangedAt", set by
  lib/auth.ts when /phone-number/verify replaces a number. `npm run
  auth:migrate:apply` can add them too, so the statements are IF NOT EXISTS,
  and nothing happens there on a database without the BetterAuth tables.
- merchants: previous_contact_number, contact_number_changed_at, set by
  PATCH /merchants/me.

A payout-change alert also goes to the old number for 3 days after a change.

Revision ID: b2d8f4a6c0e3
Revises: d3f7b1e9a5c2
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b2d8f4a6c0e3"
down_revision: str | Sequence[str] | None = "d3f7b1e9a5c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_user_table(bind) -> bool:
    return (
        bind.dialect.name == "postgresql"
        and bind.execute(sa.text("SELECT to_regclass('public.\"user\"')")).scalar()
        is not None
    )


def upgrade() -> None:
    op.add_column(
        "merchants", sa.Column("previous_contact_number", sa.String(), nullable=True)
    )
    op.add_column(
        "merchants",
        sa.Column(
            "contact_number_changed_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    if _has_user_table(op.get_bind()):
        op.execute(
            'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "previousPhoneNumber" text'
        )
        op.execute(
            'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phoneNumberChangedAt" timestamptz'
        )


def downgrade() -> None:
    if _has_user_table(op.get_bind()):
        op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS "phoneNumberChangedAt"')
        op.execute('ALTER TABLE "user" DROP COLUMN IF EXISTS "previousPhoneNumber"')
    op.drop_column("merchants", "contact_number_changed_at")
    op.drop_column("merchants", "previous_contact_number")

"""Orders: why it was cancelled.

A farm must give a reason to cancel; it is kept on the order so the buyer can
read it on the order page. Admin and sweep cancellations store theirs too.
Older cancelled orders have none.

Revision ID: e2c8a4f6d0b3
Revises: b9d4f2a6c8e1
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e2c8a4f6d0b3"
down_revision: str | Sequence[str] | None = "b9d4f2a6c8e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("cancel_reason", sa.String(400), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "cancel_reason")

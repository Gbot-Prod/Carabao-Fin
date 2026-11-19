"""Merge the main and improve/loop migration heads. No schema change.

main: shop page draft -> transaction user set null -> order close/purge
(d2a6f8c4e1b7). improve/loop: review reply -> vouchers -> holiday mode ->
hidden orders -> review moderation (e3a5c7e9b1d4). Both start at e4a8c2f6b0d3
and touch different tables and columns, so their order does not matter.

Revision ID: f5b7d9e1a3c6
Revises: d2a6f8c4e1b7, e3a5c7e9b1d4
Create Date: 2026-11-20
"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "f5b7d9e1a3c6"
down_revision: str | Sequence[str] | None = ("d2a6f8c4e1b7", "e3a5c7e9b1d4")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

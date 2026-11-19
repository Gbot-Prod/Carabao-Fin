"""Keep payment records when a buyer deletes their account (CF-0041).

transactions.user_id becomes nullable with ON DELETE SET NULL, like
orders.user_id, so the account row can go while the payment record stays.

Revision ID: b9e4c7a2d5f1
Revises: f3b7d1a9c5e2
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b9e4c7a2d5f1"
down_revision: str | Sequence[str] | None = "f3b7d1a9c5e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NEW_FK = "fk_transactions_user_id"


def _user_fk_name() -> str | None:
    """The current FK on transactions.user_id, whatever it was named."""
    inspector = sa.inspect(op.get_bind())
    for fk in inspector.get_foreign_keys("transactions"):
        if fk["constrained_columns"] == ["user_id"]:
            return fk["name"]
    return None


def upgrade() -> None:
    old = _user_fk_name()
    if old:
        op.drop_constraint(old, "transactions", type_="foreignkey")
    op.alter_column(
        "transactions", "user_id", existing_type=sa.Integer(), nullable=True
    )
    op.create_foreign_key(
        NEW_FK,
        "transactions",
        "backend_users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    # Fails if a deleted buyer left a transaction with no user.
    op.drop_constraint(NEW_FK, "transactions", type_="foreignkey")
    op.alter_column(
        "transactions", "user_id", existing_type=sa.Integer(), nullable=False
    )
    op.create_foreign_key(
        "transactions_user_id_fkey",
        "transactions",
        "backend_users",
        ["user_id"],
        ["id"],
    )

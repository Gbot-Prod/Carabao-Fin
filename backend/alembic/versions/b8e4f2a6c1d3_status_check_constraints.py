"""Restrict order, transaction and payout statuses to their known values.

Mirrors app/models/statuses.py at the time of writing (the values are copied
here on purpose: a migration must not change when the enums do). Legacy rows
written in mixed case are lowercased first; any other unknown value stops the
upgrade so it can be fixed by hand rather than guessed at.

Revision ID: b8e4f2a6c1d3
Revises: a1d7c3e9f5b2
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8e4f2a6c1d3"
down_revision: str | Sequence[str] | None = "a1d7c3e9f5b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONSTRAINTS: dict[str, tuple[str, tuple[str, ...]]] = {
    "orders": (
        "ck_orders_status",
        (
            "pending",
            "processing",
            "shipped",
            "out_for_delivery",
            "delivered",
            "cancelled",
        ),
    ),
    "transactions": (
        "ck_transactions_status",
        ("pending", "paid", "failed", "expired", "refund_pending", "refunded"),
    ),
    "payout_batches": (
        "ck_payout_batches_status",
        ("pending", "approved", "processing", "released", "failed"),
    ),
}


def _in_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    for table, (name, values) in CONSTRAINTS.items():
        existing = {c["name"] for c in inspector.get_check_constraints(table)}
        if name in existing:
            continue

        op.execute(
            f"UPDATE {table} SET status = lower(trim(status)) "
            f"WHERE status <> lower(trim(status))"
        )
        unknown = [
            row[0]
            for row in bind.execute(
                sa.text(
                    f"SELECT DISTINCT status FROM {table} "
                    f"WHERE status NOT IN ({_in_list(values)})"
                )
            )
        ]
        if unknown:
            raise RuntimeError(
                f"{table}.status holds values outside {values}: {unknown}. "
                "Fix or map those rows, then rerun the upgrade."
            )

        op.create_check_constraint(name, table, f"status IN ({_in_list(values)})")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    for table, (name, _values) in CONSTRAINTS.items():
        existing = {c["name"] for c in inspector.get_check_constraints(table)}
        if name in existing:
            op.drop_constraint(name, table, type_="check")

"""Money/stock CHECKs, merchant suspension, drop application delivery fields.

CF-0009: produces.price > 0, produces.stock_quantity >= 0,
orders.total_price >= 0, transactions.amount > 0. Before each CHECK is added,
the rows that would fail it are counted; if any exist the upgrade stops and
names them, so they are fixed by hand rather than guessed at. The query to run
first is in FIND_BAD_ROWS below.

CF-0010: merchants.suspended_at, set when an admin suspends an approved
application.

CF-0011: onboarding no longer asks for a delivery time or price, so the two
columns leave merchant_applications. merchants.delivery_price/delivery_time
stay: the order delivery fee still reads merchants.delivery_price.

Revision ID: c5e9a2d7f4b1
Revises: e2b6d9f4a1c7
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

revision: str = "c5e9a2d7f4b1"
down_revision: str | Sequence[str] | None = "e2b6d9f4a1c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, constraint name, condition that must hold)
CHECKS = (
    ("produces", "ck_produces_price_positive", "price > 0"),
    ("produces", "ck_produces_stock_not_negative", "stock_quantity >= 0"),
    ("orders", "ck_orders_total_not_negative", "total_price >= 0"),
    ("transactions", "ck_transactions_amount_positive", "amount > 0"),
)

# Run before the upgrade to find (and fix) rows the CHECKs would refuse.
FIND_BAD_ROWS = """
SELECT 'produces' AS tbl, id, 'price=' || price AS bad FROM produces WHERE price <= 0
UNION ALL
SELECT 'produces', id, 'stock_quantity=' || stock_quantity FROM produces WHERE stock_quantity < 0
UNION ALL
SELECT 'orders', id, 'total_price=' || total_price FROM orders WHERE total_price < 0
UNION ALL
SELECT 'transactions', id, 'amount=' || amount FROM transactions WHERE amount <= 0
"""


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    bad = bind.execute(sa.text(FIND_BAD_ROWS)).all()
    if bad:
        listed = ", ".join(f"{t}#{i} ({b})" for t, i, b in bad[:20])
        raise RuntimeError(
            f"{len(bad)} row(s) would fail the new CHECK constraints: {listed}. "
            "Fix them, then run the upgrade again."
        )

    for table, name, condition in CHECKS:
        existing = {c["name"] for c in inspector.get_check_constraints(table)}
        if name not in existing:
            op.create_check_constraint(name, table, condition)

    merchant_columns = {c["name"] for c in inspector.get_columns("merchants")}
    if "suspended_at" not in merchant_columns:
        op.add_column(
            "merchants",
            sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "ix_merchants_suspended_at", "merchants", ["suspended_at"]
        )

    for column in ("delivery_time", "delivery_price"):
        op.execute(
            f"ALTER TABLE merchant_applications DROP COLUMN IF EXISTS {column}"
        )


def downgrade() -> None:
    # Back as nullable: the old values are gone.
    for column in ("delivery_time", "delivery_price"):
        op.add_column(
            "merchant_applications", sa.Column(column, sa.Integer(), nullable=True)
        )

    op.drop_index("ix_merchants_suspended_at", table_name="merchants")
    op.drop_column("merchants", "suspended_at")

    for table, name, _condition in reversed(CHECKS):
        op.drop_constraint(name, table, type_="check")

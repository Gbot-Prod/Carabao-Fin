"""Fold current_orders into orders and drop the side table.

current_orders was a 1:1 copy of orders (order_id was unique) that duplicated
status and merchant_id. The only columns it held on its own were the route
ETA, the checkout delivery fee and the checkout image; those move onto orders.

Revision ID: a1d7c3e9f5b2
Revises: f2c6a9d4b8e1
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1d7c3e9f5b2"
down_revision: str | Sequence[str] | None = "f2c6a9d4b8e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("orders")}

    if "time_of_arrival" not in columns:
        op.add_column(
            "orders",
            sa.Column("time_of_arrival", sa.DateTime(timezone=True), nullable=True),
        )
    if "delivery_fee" not in columns:
        op.add_column(
            "orders",
            sa.Column(
                "delivery_fee", sa.Integer(), nullable=False, server_default="0"
            ),
        )
    if "image" not in columns:
        op.add_column("orders", sa.Column("image", sa.String(), nullable=True))

    if inspector.has_table("current_orders"):
        op.execute(
            """
            UPDATE orders AS o
            SET time_of_arrival = co.time_of_arrival,
                delivery_fee = COALESCE(co.delivery_fee, 0),
                image = co.image
            FROM current_orders AS co
            WHERE co.order_id = o.id
            """
        )
        op.drop_table("current_orders")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if not inspector.has_table("current_orders"):
        op.create_table(
            "current_orders",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "order_id",
                sa.Integer(),
                sa.ForeignKey("orders.id"),
                nullable=False,
                unique=True,
            ),
            sa.Column(
                "merchant_id",
                sa.Integer(),
                sa.ForeignKey("merchants.id"),
                nullable=True,
            ),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("time_of_arrival", sa.DateTime(timezone=True), nullable=True),
            sa.Column("delivery_fee", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("image", sa.String(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.now(),
                nullable=False,
            ),
        )
        op.create_index("ix_current_orders_id", "current_orders", ["id"])
        op.create_index("ix_current_orders_order_id", "current_orders", ["order_id"])
        op.create_index(
            "ix_current_orders_merchant_id", "current_orders", ["merchant_id"]
        )
        op.create_index("ix_current_orders_status", "current_orders", ["status"])
        op.execute(
            """
            INSERT INTO current_orders
                (order_id, merchant_id, status, time_of_arrival, delivery_fee,
                 image, created_at)
            SELECT id, merchant_id, status, time_of_arrival, delivery_fee,
                   image, ordered_at
            FROM orders
            """
        )

    columns = {column["name"] for column in inspector.get_columns("orders")}
    for name in ("image", "delivery_fee", "time_of_arrival"):
        if name in columns:
            op.drop_column("orders", name)

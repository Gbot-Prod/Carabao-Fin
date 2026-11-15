"""Single user name, live 2FA, orders keyed by user only.

- backend_users.first_name + last_name -> name (joined with a space), matching
  BetterAuth's "user".name.
- backend_users.two_factor_enabled is dropped: the backend reads BetterAuth's
  "user"."twoFactorEnabled" live instead of caching it from access tokens.
- order_histories is dropped with orders.order_history_id: it was one row per
  user, duplicating orders.user_id. user_id is backfilled from it first.

Revision ID: f1a5c9e3b7d4
Revises: e8b2d6f0a4c7
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f1a5c9e3b7d4"
down_revision: str | Sequence[str] | None = "e8b2d6f0a4c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── Name ──
    op.add_column("backend_users", sa.Column("name", sa.String(), nullable=True))
    op.execute(
        """
        UPDATE backend_users
        SET name = NULLIF(trim(concat_ws(' ', trim(first_name), trim(last_name))), '')
        """
    )
    op.create_index("ix_backend_users_name", "backend_users", ["name"])
    # Their indexes go with them.
    op.drop_column("backend_users", "first_name")
    op.drop_column("backend_users", "last_name")

    # ── 2FA cache ──
    op.drop_column("backend_users", "two_factor_enabled")

    # ── Order histories ──
    op.execute(
        """
        UPDATE orders SET user_id = oh.user_id
        FROM order_histories oh
        WHERE orders.order_history_id = oh.id AND orders.user_id IS NULL
        """
    )
    op.drop_column("orders", "order_history_id")  # drops its FK and index
    op.drop_table("order_histories")


def downgrade() -> None:
    # ── Order histories (one per user with orders; orders whose user is gone
    # keep a NULL order_history_id, so the column stays nullable) ──
    op.create_table(
        "order_histories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id"),
            nullable=False,
            unique=True,
        ),
        sa.Column("last_order_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_order_histories_id", "order_histories", ["id"])
    op.create_index("ix_order_histories_user_id", "order_histories", ["user_id"])
    op.execute(
        """
        INSERT INTO order_histories (user_id, last_order_at)
        SELECT user_id, max(ordered_at) FROM orders
        WHERE user_id IS NOT NULL GROUP BY user_id
        """
    )
    op.add_column(
        "orders",
        sa.Column(
            "order_history_id",
            sa.Integer(),
            sa.ForeignKey("order_histories.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_orders_order_history_id", "orders", ["order_history_id"])
    op.execute(
        """
        UPDATE orders SET order_history_id = oh.id
        FROM order_histories oh WHERE oh.user_id = orders.user_id
        """
    )

    # ── 2FA cache (refilled from the next access token) ──
    op.add_column(
        "backend_users",
        sa.Column(
            "two_factor_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # ── Name (split at the first space) ──
    op.add_column("backend_users", sa.Column("first_name", sa.String(), nullable=True))
    op.add_column("backend_users", sa.Column("last_name", sa.String(), nullable=True))
    op.execute(
        """
        UPDATE backend_users
        SET first_name = split_part(name, ' ', 1),
            last_name = NULLIF(substr(name, length(split_part(name, ' ', 1)) + 2), '')
        WHERE name IS NOT NULL
        """
    )
    op.create_index("ix_backend_users_first_name", "backend_users", ["first_name"])
    op.create_index("ix_backend_users_last_name", "backend_users", ["last_name"])
    op.drop_index("ix_backend_users_name", table_name="backend_users")
    op.drop_column("backend_users", "name")

"""Remove merchant vouchers and the order discount (MVP scope cut).

Revision ID: c4e6a8b0d2f3
Revises: a2b4c6d8e0f1
Create Date: 2026-11-26

Undoes b7d9f1a3c5e8. The downgrade puts the empty tables and columns back.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c4e6a8b0d2f3"
down_revision: str | Sequence[str] | None = "a2b4c6d8e0f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("orders", "voucher_code")
    op.drop_column("orders", "discount")
    op.drop_index("ix_voucher_redemptions_user_id", table_name="voucher_redemptions")
    op.drop_index(
        "ix_voucher_redemptions_voucher_id", table_name="voucher_redemptions"
    )
    op.drop_index("ix_voucher_redemptions_id", table_name="voucher_redemptions")
    op.drop_table("voucher_redemptions")
    op.drop_index("ix_vouchers_merchant_id", table_name="vouchers")
    op.drop_index("ix_vouchers_id", table_name="vouchers")
    op.drop_table("vouchers")


def downgrade() -> None:
    op.create_table(
        "vouchers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "merchant_id",
            sa.Integer(),
            sa.ForeignKey("merchants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("value", sa.Integer(), nullable=False),
        sa.Column("min_subtotal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_discount", sa.Integer(), nullable=True),
        sa.Column("usage_limit", sa.Integer(), nullable=True),
        sa.Column("per_user_limit", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("merchant_id", "code", name="uq_vouchers_merchant_code"),
        sa.CheckConstraint("kind IN ('percent', 'fixed')", name="ck_vouchers_kind"),
        sa.CheckConstraint(
            "(kind = 'percent' AND value BETWEEN 1 AND 90) "
            "OR (kind = 'fixed' AND value >= 1)",
            name="ck_vouchers_value",
        ),
        sa.CheckConstraint("min_subtotal >= 0", name="ck_vouchers_min_subtotal"),
        sa.CheckConstraint(
            "max_discount IS NULL OR max_discount >= 1",
            name="ck_vouchers_max_discount",
        ),
        sa.CheckConstraint(
            "usage_limit IS NULL OR usage_limit >= 1", name="ck_vouchers_usage_limit"
        ),
        sa.CheckConstraint("per_user_limit >= 1", name="ck_vouchers_per_user_limit"),
    )
    op.create_index("ix_vouchers_id", "vouchers", ["id"])
    op.create_index("ix_vouchers_merchant_id", "vouchers", ["merchant_id"])

    op.create_table(
        "voucher_redemptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "voucher_id",
            sa.Integer(),
            sa.ForeignKey("vouchers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("discount", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("order_id", name="uq_voucher_redemptions_order"),
        sa.CheckConstraint("discount >= 1", name="ck_voucher_redemptions_discount"),
    )
    op.create_index("ix_voucher_redemptions_id", "voucher_redemptions", ["id"])
    op.create_index(
        "ix_voucher_redemptions_voucher_id", "voucher_redemptions", ["voucher_id"]
    )
    op.create_index(
        "ix_voucher_redemptions_user_id", "voucher_redemptions", ["user_id"]
    )

    # Defaults fill existing orders; no table rewrite for the nullable code.
    op.add_column(
        "orders",
        sa.Column("discount", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("orders", sa.Column("voucher_code", sa.String(32), nullable=True))

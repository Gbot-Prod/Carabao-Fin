"""Order proof photos: packing, drop-off and failed drop-off photos.

Revision ID: e1c3a5b7d9f2
Revises: d4f6a8c0e2b5
Create Date: 2026-11-26

documentation/plans/ORDER_PROOF_PHOTOS_PLAN.md. A new table for the photos
(one per order and kind), and on orders the delivery hold and dispute
columns for a merchant-set delivery.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e1c3a5b7d9f2"
down_revision: str | Sequence[str] | None = "d4f6a8c0e2b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "order_proof_photos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("object_key", sa.String(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column(
            "taken_by_user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("distance_m", sa.Integer(), nullable=True),
        sa.Column("flags", sa.JSON(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "order_id", "kind", name="uq_order_proof_photos_order_kind"
        ),
        sa.CheckConstraint(
            "kind IN ('packing', 'dropoff', 'attempt')",
            name="ck_order_proof_photos_kind",
        ),
    )
    op.create_index(
        "ix_order_proof_photos_order_id", "order_proof_photos", ["order_id"]
    )
    op.create_index("ix_order_proof_photos_sha256", "order_proof_photos", ["sha256"])

    for column in (
        "delivery_buyer_confirmed_at",
        "delivery_disputed_at",
        "dispute_resolved_at",
    ):
        op.add_column(
            "orders", sa.Column(column, sa.DateTime(timezone=True), nullable=True)
        )
    op.add_column(
        "orders", sa.Column("dispute_resolution", sa.String(length=16), nullable=True)
    )
    op.add_column(
        "orders",
        sa.Column(
            "dispute_resolved_by",
            sa.Integer(),
            sa.ForeignKey(
                "backend_users.id",
                ondelete="SET NULL",
                name="fk_orders_dispute_resolved_by",
            ),
            nullable=True,
        ),
    )
    op.create_check_constraint(
        "ck_orders_dispute_resolution",
        "orders",
        "dispute_resolution IS NULL OR dispute_resolution IN ('release', 'refund')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_orders_dispute_resolution", "orders", type_="check")
    op.drop_constraint("fk_orders_dispute_resolved_by", "orders", type_="foreignkey")
    for column in (
        "dispute_resolved_by",
        "dispute_resolution",
        "dispute_resolved_at",
        "delivery_disputed_at",
        "delivery_buyer_confirmed_at",
    ):
        op.drop_column("orders", column)
    op.drop_index("ix_order_proof_photos_sha256", table_name="order_proof_photos")
    op.drop_index("ix_order_proof_photos_order_id", table_name="order_proof_photos")
    op.drop_table("order_proof_photos")

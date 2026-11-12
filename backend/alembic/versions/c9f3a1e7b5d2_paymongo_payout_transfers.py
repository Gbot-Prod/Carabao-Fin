"""Track PayMongo transfers on payout batches; store the payout bank's name.

Payout batches gain the transfer they were sent as (fee, net amount, our
reference, PayMongo's ids, failure reason and a copy of the destination).
merchant_payout_info.bank_code now holds a PayMongo institution code (BIC);
rows saved before this hold free text and must be re-picked by the merchant.

Revision ID: c9f3a1e7b5d2
Revises: d4f8b2c6e1a9
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c9f3a1e7b5d2"
down_revision: str | Sequence[str] | None = "d4f8b2c6e1a9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NULLABLE_COLUMNS: list[tuple[str, sa.types.TypeEngine]] = [
    ("transfer_fee", sa.Integer()),
    ("net_amount", sa.Integer()),
    ("paymongo_reference", sa.String()),
    ("paymongo_transfer_id", sa.String()),
    ("provider_reference", sa.String()),
    ("failure_reason", sa.Text()),
    ("sent_at", sa.DateTime(timezone=True)),
    ("destination_type", sa.String()),
    ("destination_bic", sa.String()),
    ("destination_name", sa.String()),
    ("destination_number", sa.String()),
    ("transfer_provider", sa.String()),
]


def upgrade() -> None:
    for name, type_ in NULLABLE_COLUMNS:
        op.add_column("payout_batches", sa.Column(name, type_, nullable=True))
    op.add_column(
        "payout_batches",
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index(
        "ix_payout_batches_paymongo_reference",
        "payout_batches",
        ["paymongo_reference"],
        unique=True,
    )
    op.create_index(
        "ix_payout_batches_paymongo_transfer_id",
        "payout_batches",
        ["paymongo_transfer_id"],
        unique=True,
    )
    op.add_column(
        "merchant_payout_info", sa.Column("bank_name", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("merchant_payout_info", "bank_name")
    op.drop_index("ix_payout_batches_paymongo_transfer_id", "payout_batches")
    op.drop_index("ix_payout_batches_paymongo_reference", "payout_batches")
    op.drop_column("payout_batches", "attempts")
    for name, _ in reversed(NULLABLE_COLUMNS):
        op.drop_column("payout_batches", name)

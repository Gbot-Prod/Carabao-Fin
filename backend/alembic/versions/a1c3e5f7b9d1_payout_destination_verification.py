"""Payout destination verification lifecycle and penny-drop attempts.

Revision ID: a1c3e5f7b9d1
Revises: e7b1d3f5a9c2
Create Date: 2026-11-27
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1c3e5f7b9d1"
down_revision: str | Sequence[str] | None = "e7b1d3f5a9c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_VERIFICATION_STATUSES = (
    "unverified",
    "pending",
    "transfer_sent",
    "verified",
    "failed",
)
_ATTEMPT_STATUSES = (
    "sending",
    "sent",
    "settled",
    "confirmed",
    "failed",
    "expired",
)


def upgrade() -> None:
    op.add_column(
        "merchant_payout_info",
        sa.Column(
            "verification_status",
            sa.Enum(
                *_VERIFICATION_STATUSES,
                name="payout_destination_verification_status",
                native_enum=False,
                length=32,
            ),
            nullable=False,
            server_default="unverified",
        ),
    )
    op.add_column(
        "merchant_payout_info",
        sa.Column("verification_method", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "merchant_payout_info",
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "merchant_payout_info",
        sa.Column("verification_error", sa.String(length=1000), nullable=True),
    )

    op.create_table(
        "payout_verification_attempts",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "merchant_id",
            sa.Integer(),
            sa.ForeignKey("merchants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("destination_fingerprint", sa.String(length=64), nullable=False, index=True),
        sa.Column("amount_centavos", sa.Integer(), nullable=False),
        sa.Column("paymongo_reference", sa.String(length=64), nullable=False, unique=True),
        sa.Column("paymongo_transfer_id", sa.String(length=64), nullable=True, index=True),
        sa.Column("provider_reference", sa.String(length=64), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                *_ATTEMPT_STATUSES,
                name="payout_verification_attempt_status",
                native_enum=False,
                length=32,
            ),
            nullable=False,
        ),
        sa.Column("failure_reason", sa.String(length=1000), nullable=True),
        sa.Column("attempts_remaining", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("payout_verification_attempts")
    op.drop_column("merchant_payout_info", "verification_error")
    op.drop_column("merchant_payout_info", "verified_at")
    op.drop_column("merchant_payout_info", "verification_method")
    op.drop_column("merchant_payout_info", "verification_status")

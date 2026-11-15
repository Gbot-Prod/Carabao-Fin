"""OTP codes and rate-limit hits in Postgres (CF-0016).

Both were held in process memory, so each API worker had its own copy. Codes
are stored as an HMAC, never in clear. Nothing is carried over: codes in
memory expire in 10 minutes and limits restart from zero.

Revision ID: c1f6a8d3e5b7
Revises: a7c3e9f1b5d2
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c1f6a8d3e5b7"
down_revision: str | Sequence[str] | None = "a7c3e9f1b5d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "otp_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(120), nullable=False, unique=True),
        sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("attempts >= 0", name="ck_otp_codes_attempts"),
    )
    op.create_index("ix_otp_codes_expires_at", "otp_codes", ["expires_at"])

    op.create_table(
        "rate_limit_hits",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("key", sa.String(200), nullable=False),
        sa.Column("hit_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_rate_limit_hits_key_hit_at", "rate_limit_hits", ["key", "hit_at"]
    )
    op.create_index("ix_rate_limit_hits_hit_at", "rate_limit_hits", ["hit_at"])


def downgrade() -> None:
    op.drop_index("ix_rate_limit_hits_hit_at", table_name="rate_limit_hits")
    op.drop_index("ix_rate_limit_hits_key_hit_at", table_name="rate_limit_hits")
    op.drop_table("rate_limit_hits")
    op.drop_index("ix_otp_codes_expires_at", table_name="otp_codes")
    op.drop_table("otp_codes")

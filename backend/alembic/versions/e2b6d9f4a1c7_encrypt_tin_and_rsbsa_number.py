"""Encrypt TIN and RSBSA number; add HMAC lookup columns (CF-0007).

tin and rsbsa_number now hold AES-256-GCM ciphertext ("v1:..."), written by
the application (app/core/field_crypto.py). The new *_hmac columns hold a
keyed hash of the normalized value, for lookups and duplicate checks.

The database was wiped, so nothing is re-encrypted here. If a plaintext value
is found, the upgrade stops: such a row would not decrypt when read.

Revision ID: e2b6d9f4a1c7
Revises: a7c3e9f1b5d2
Create Date: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import context, op

revision: str = "e2b6d9f4a1c7"
down_revision: str | Sequence[str] | None = "a7c3e9f1b5d2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLES = ("merchants", "merchant_applications")
COLUMNS = ("tin", "rsbsa_number")


def _refuse_plaintext(table: str, column: str) -> None:
    plaintext = (
        op.get_bind()
        .execute(
            sa.text(
                f"SELECT count(*) FROM {table} "
                f"WHERE {column} IS NOT NULL AND {column} NOT LIKE 'v1:%'"
            )
        )
        .scalar_one()
    )
    if plaintext:
        raise RuntimeError(
            f"{table}.{column} has {plaintext} plaintext value(s). "
            "Clear or encrypt them before this upgrade."
        )


def upgrade() -> None:
    offline = context.is_offline_mode()
    for table in TABLES:
        for column in COLUMNS:
            if not offline:
                _refuse_plaintext(table, column)
            op.alter_column(
                table,
                column,
                existing_type=sa.String(),
                type_=sa.Text(),
                existing_nullable=True,
            )
            op.add_column(table, sa.Column(f"{column}_hmac", sa.String(64)))
            op.create_index(f"ix_{table}_{column}_hmac", table, [f"{column}_hmac"])


def downgrade() -> None:
    # The ciphertext stays in place; it cannot be turned back into plaintext
    # without the application key.
    for table in TABLES:
        for column in COLUMNS:
            op.drop_index(f"ix_{table}_{column}_hmac", table_name=table)
            op.drop_column(table, f"{column}_hmac")
            op.alter_column(
                table,
                column,
                existing_type=sa.Text(),
                type_=sa.String(),
                existing_nullable=True,
            )

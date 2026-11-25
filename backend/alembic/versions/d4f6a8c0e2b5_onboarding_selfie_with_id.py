"""Selfie with ID: a camera photo of the applicant holding the government ID.

Revision ID: d4f6a8c0e2b5
Revises: c8e2a4f6b0d1
Create Date: 2026-11-26

The R2 key and metadata on merchant_applications and merchants (copied on
approval, as with the other documents), and the file SHA-256 on
merchant_applications for the duplicate check.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f6a8c0e2b5"
down_revision: str | Sequence[str] | None = "c8e2a4f6b0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("merchant_applications", "merchants")
_COLUMNS = (
    "selfie_document_path",
    "selfie_document_original_name",
    "selfie_document_content_type",
)


def upgrade() -> None:
    for table in _TABLES:
        for column in _COLUMNS:
            op.add_column(table, sa.Column(column, sa.String(), nullable=True))
    op.add_column(
        "merchant_applications",
        sa.Column("selfie_file_sha256", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_merchant_applications_selfie_file_sha256",
        "merchant_applications",
        ["selfie_file_sha256"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_merchant_applications_selfie_file_sha256",
        table_name="merchant_applications",
    )
    op.drop_column("merchant_applications", "selfie_file_sha256")
    for table in _TABLES:
        for column in _COLUMNS:
            op.drop_column(table, column)

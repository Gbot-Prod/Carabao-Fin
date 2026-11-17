"""Merchant onboarding: government ID upload, reviewer, document check columns.

- merchant_applications and merchants: gov_id_type and the gov ID document
  (R2 key, original name, content type). Required, like the RSBSA document.
- merchant_applications: reviewed_by_user_id, reviewed_at (last admin decision).
- merchants: verified_by_user_id, verified_at (the approving admin).
- merchant_applications: the columns that the automated document checks fill
  (app/services/document_checks.py). All nullable. Numbers are blind indexes;
  the OCR text is not stored.

The database was wiped, so there is no backfill.

Revision ID: dce435b8fceb
Revises: b2d8f4a6c0e3
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "dce435b8fceb"
down_revision: str | Sequence[str] | None = "b2d8f4a6c0e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_GOV_ID_COLUMNS = (
    ("gov_id_type", False),
    ("gov_id_document_path", False),
    ("gov_id_document_original_name", True),
    ("gov_id_document_content_type", True),
)

_CHECK_COLUMNS = (
    sa.Column("gov_id_number_hmac", sa.String(64), nullable=True),
    sa.Column("ocr_rsbsa_number_hmac", sa.String(64), nullable=True),
    sa.Column("gov_id_file_sha256", sa.String(64), nullable=True),
    sa.Column("rsbsa_file_sha256", sa.String(64), nullable=True),
    sa.Column("ocr_gov_id_name", sa.String(), nullable=True),
    sa.Column("ocr_rsbsa_number", sa.String(), nullable=True),
    sa.Column("name_match_score", sa.Float(), nullable=True),
    sa.Column("check_flags", sa.JSON(), nullable=True),
    sa.Column("check_status", sa.String(), nullable=True),
    sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
)

_CHECK_INDEXES = (
    "gov_id_number_hmac",
    "ocr_rsbsa_number_hmac",
    "gov_id_file_sha256",
    "rsbsa_file_sha256",
    "check_status",
)


def _index_name(column: str) -> str:
    if column in ("gov_id_number_hmac", "ocr_rsbsa_number_hmac"):
        return f"ix_merchant_applications_{column}"
    return op.f(f"ix_merchant_applications_{column}")


def upgrade() -> None:
    for table in ("merchant_applications", "merchants"):
        for name, nullable in _GOV_ID_COLUMNS:
            op.add_column(table, sa.Column(name, sa.String(), nullable=nullable))

    op.add_column(
        "merchant_applications",
        sa.Column(
            "reviewed_by_user_id",
            sa.Integer(),
            sa.ForeignKey(
                "backend_users.id",
                ondelete="SET NULL",
                name="fk_merchant_applications_reviewed_by_user_id",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "merchant_applications",
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "merchants",
        sa.Column(
            "verified_by_user_id",
            sa.Integer(),
            sa.ForeignKey(
                "backend_users.id",
                ondelete="SET NULL",
                name="fk_merchants_verified_by_user_id",
            ),
            nullable=True,
        ),
    )
    op.add_column(
        "merchants", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True)
    )

    for column in _CHECK_COLUMNS:
        op.add_column("merchant_applications", column.copy())
    for column in _CHECK_INDEXES:
        op.create_index(_index_name(column), "merchant_applications", [column])


def downgrade() -> None:
    for column in reversed(_CHECK_INDEXES):
        op.drop_index(_index_name(column), table_name="merchant_applications")
    for column in reversed(_CHECK_COLUMNS):
        op.drop_column("merchant_applications", column.name)

    op.drop_constraint("fk_merchants_verified_by_user_id", "merchants", type_="foreignkey")
    op.drop_column("merchants", "verified_at")
    op.drop_column("merchants", "verified_by_user_id")
    op.drop_constraint(
        "fk_merchant_applications_reviewed_by_user_id",
        "merchant_applications",
        type_="foreignkey",
    )
    op.drop_column("merchant_applications", "reviewed_at")
    op.drop_column("merchant_applications", "reviewed_by_user_id")

    for table in ("merchants", "merchant_applications"):
        for name, _ in reversed(_GOV_ID_COLUMNS):
            op.drop_column(table, name)

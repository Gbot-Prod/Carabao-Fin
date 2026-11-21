"""Merchant onboarding: seller type, tax information, submit later.

* ``seller_type`` replaces ``business_type`` on applications and merchants.
  Old values map as Farmer -> individual_farmer, Sole Proprietor ->
  sole_proprietor, Partnership / Corporation -> corporation, Cooperative ->
  cooperative. ``business_type`` is then dropped (nothing reads it any more).
* Name parts, company and trade name, VAT status, the BIR Form 2303 document,
  the small agricultural producer declaration (BIR RR No. 12-2023) and the
  Terms acceptance are new columns.
* A ``pending_documents`` application ("Submit later") has no business
  information yet, so merchant_name, gov_id_type and the RSBSA / government ID
  document paths may be NULL on applications.

Existing rows keep their status: approved merchants stay approved.

Revision ID: b8d2f4a6c1e3
Revises: a7c9e1b3d5f8
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8d2f4a6c1e3"
down_revision: str | Sequence[str] | None = "a7c9e1b3d5f8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SELLER_FROM_BUSINESS = (
    "CASE business_type "
    "WHEN 'Farmer' THEN 'individual_farmer' "
    "WHEN 'Sole Proprietor' THEN 'sole_proprietor' "
    "WHEN 'Partnership' THEN 'corporation' "
    "WHEN 'Corporation' THEN 'corporation' "
    "WHEN 'Cooperative' THEN 'cooperative' "
    # Not a value the form ever offered; the least demanding type.
    "ELSE 'individual_farmer' END"
)
# Kept as constants so tests can run the backfill against old rows.
BACKFILL = (
    f"UPDATE merchant_applications SET seller_type = {_SELLER_FROM_BUSINESS}",
    f"UPDATE merchants SET seller_type = {_SELLER_FROM_BUSINESS}",
)

_BUSINESS_FROM_SELLER = (
    "CASE seller_type "
    "WHEN 'sole_proprietor' THEN 'Sole Proprietor' "
    "WHEN 'corporation' THEN 'Corporation' "
    "WHEN 'cooperative' THEN 'Cooperative' "
    "ELSE 'Farmer' END"
)

_PERSON_COLUMNS = (
    "last_name",
    "first_name",
    "middle_name",
    "rep_last_name",
    "rep_first_name",
    "rep_middle_name",
)


def _application_columns() -> list[sa.Column]:
    columns = [sa.Column("seller_type", sa.String(), nullable=True)]
    columns += [
        sa.Column(name, sa.String(80), nullable=True) for name in _PERSON_COLUMNS
    ]
    columns += [
        sa.Column("suffix", sa.String(10), nullable=True),
        sa.Column("rep_suffix", sa.String(10), nullable=True),
        sa.Column("company_name", sa.String(255), nullable=True),
        sa.Column("trade_name", sa.String(255), nullable=True),
        sa.Column("vat_status", sa.String(20), nullable=True),
        sa.Column("bir_cert_document_path", sa.String(), nullable=True),
        sa.Column("bir_cert_document_original_name", sa.String(), nullable=True),
        sa.Column("bir_cert_document_content_type", sa.String(), nullable=True),
        sa.Column("small_agri_producer", sa.Boolean(), nullable=True),
        sa.Column("small_agri_declared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("small_agri_declared_year", sa.Integer(), nullable=True),
        sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("terms_version", sa.String(40), nullable=True),
    ]
    return columns


def _merchant_columns() -> list[sa.Column]:
    return [
        sa.Column("seller_type", sa.String(), nullable=True),
        sa.Column("vat_status", sa.String(20), nullable=True),
        sa.Column("small_agri_producer", sa.Boolean(), nullable=True),
        sa.Column("small_agri_declared_year", sa.Integer(), nullable=True),
        sa.Column("bir_cert_document_path", sa.String(), nullable=True),
        sa.Column("bir_cert_document_original_name", sa.String(), nullable=True),
        sa.Column("bir_cert_document_content_type", sa.String(), nullable=True),
    ]


# Application columns a pending_documents row leaves empty.
_RELAXED = (
    "merchant_name",
    "gov_id_type",
    "rsbsa_document_path",
    "gov_id_document_path",
)


def upgrade() -> None:
    for column in _application_columns():
        op.add_column("merchant_applications", column)
    for column in _merchant_columns():
        op.add_column("merchants", column)

    for sql in BACKFILL:
        op.execute(sql)

    op.create_index(
        "ix_merchant_applications_seller_type",
        "merchant_applications",
        ["seller_type"],
    )
    op.alter_column("merchants", "seller_type", nullable=False)
    for name in _RELAXED:
        op.alter_column("merchant_applications", name, nullable=True)

    op.drop_column("merchant_applications", "business_type")
    op.drop_column("merchants", "business_type")


def downgrade() -> None:
    op.add_column(
        "merchant_applications", sa.Column("business_type", sa.String(), nullable=True)
    )
    op.add_column("merchants", sa.Column("business_type", sa.String(), nullable=True))
    op.execute(
        f"UPDATE merchant_applications SET business_type = {_BUSINESS_FROM_SELLER}"
    )
    op.execute(f"UPDATE merchants SET business_type = {_BUSINESS_FROM_SELLER}")
    op.alter_column("merchant_applications", "business_type", nullable=False)
    op.alter_column("merchants", "business_type", nullable=False)

    # pending_documents rows have no business information; the old schema
    # needs a value in each of these.
    for name in _RELAXED:
        op.execute(f"UPDATE merchant_applications SET {name} = '' WHERE {name} IS NULL")
        op.alter_column("merchant_applications", name, nullable=False)

    op.drop_index(
        "ix_merchant_applications_seller_type", table_name="merchant_applications"
    )
    for column in reversed(_merchant_columns()):
        op.drop_column("merchants", column.name)
    for column in reversed(_application_columns()):
        op.drop_column("merchant_applications", column.name)

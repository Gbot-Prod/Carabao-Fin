"""Merchant access before verification; review checklist; setup reminders.

* merchants.verification_status (setup | under_review | needs_changes |
  verified | suspended). A merchant row now exists from the first onboarding
  step; only verified merchants sell (services/merchant_verification.py).
* merchants.seller_type, gov_id_type, rsbsa_document_path and
  gov_id_document_path become nullable: they are copied at approval.
* merchant_applications: BIR 2303 extraction columns (TIN encrypted plus a
  blind index, name encrypted), the stored checklist and the admin's
  confirmations (services/document_checks.py).
* merchant_setup_reminders: the Submit later reminders that were sent.

Backfill (nobody already selling loses access or goes offline):
* every existing merchant was approved: ``verified``; a suspended one
  (suspended_at set, or its application suspended): ``suspended``;
* an open application (pending_documents, submitted, clarification,
  rejected) without a merchant gets one, with the mapped status and a draft
  shop page. A contact number another merchant already holds is left NULL.

Revision ID: c3d5e7f9a1b4
Revises: b8d2f4a6c1e3
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c3d5e7f9a1b4"
down_revision: str | Sequence[str] | None = "b8d2f4a6c1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

STATUSES = ("setup", "under_review", "needs_changes", "verified", "suspended")
OPEN_APPLICATIONS = ("pending_documents", "submitted", "clarification", "rejected")
_NOW_NULLABLE = (
    "seller_type",
    "gov_id_type",
    "rsbsa_document_path",
    "gov_id_document_path",
)
_MAPPED = (
    "CASE a.status "
    "WHEN 'pending_documents' THEN 'setup' "
    "WHEN 'submitted' THEN 'under_review' "
    "WHEN 'clarification' THEN 'needs_changes' "
    "WHEN 'rejected' THEN 'needs_changes' "
    "END"
)
_OPEN = ", ".join(f"'{status}'" for status in OPEN_APPLICATIONS)


def backfill_statements(dialect: str) -> list[str]:
    """The backfill, in order. A function so tests can run it on SQLite."""
    empty_json = "'{}'" if dialect == "sqlite" else "CAST('{}' AS JSON)"
    return [
        # Existing merchants were all approved.
        "UPDATE merchants SET verification_status = 'verified'",
        "UPDATE merchants SET verification_status = 'suspended' "
        "WHERE suspended_at IS NOT NULL OR EXISTS (SELECT 1 FROM "
        "merchant_applications a WHERE a.merchant_id = merchants.id "
        "AND a.status = 'suspended')",
        # A closed merchant whose owner applied again: reopen it, unverified.
        f"UPDATE merchants SET deleted_at = NULL, verified_at = NULL, "
        f"verified_by_user_id = NULL, verification_status = (SELECT {_MAPPED} "
        f"FROM merchant_applications a WHERE a.user_id = merchants.user_id) "
        f"WHERE deleted_at IS NOT NULL AND EXISTS (SELECT 1 FROM "
        f"merchant_applications a WHERE a.user_id = merchants.user_id "
        f"AND a.merchant_id IS NULL AND a.status IN ({_OPEN}))",
        # An open application with no merchant row: create one.
        "INSERT INTO merchants (user_id, merchant_name, seller_type, contact_email, "
        "contact_number, region, province, city, barangay, address, postal_code, "
        "lat, lng, road_lat, road_lng, pin_confirmed, available_days, "
        "operating_hours, verification_status, rating_count, low_stock_threshold, "
        "created_at, updated_at) "
        "SELECT a.user_id, COALESCE(a.merchant_name, 'My farm'), a.seller_type, "
        "a.contact_email, CASE WHEN EXISTS (SELECT 1 FROM merchants m WHERE "
        "m.contact_number = a.contact_number) THEN NULL ELSE a.contact_number END, "
        "a.region, a.province, a.city, a.barangay, a.address, a.postal_code, "
        "a.lat, a.lng, a.road_lat, a.road_lng, a.pin_confirmed, a.available_days, "
        f"{empty_json}, {_MAPPED}, 0, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP "
        "FROM merchant_applications a "
        f"WHERE a.merchant_id IS NULL AND a.status IN ({_OPEN}) "
        "AND NOT EXISTS (SELECT 1 FROM merchants m WHERE m.user_id = a.user_id)",
        # Link them.
        "UPDATE merchant_applications SET merchant_id = (SELECT m.id FROM "
        "merchants m WHERE m.user_id = merchant_applications.user_id) "
        f"WHERE merchant_id IS NULL AND status IN ({_OPEN})",
        # A draft (unpublished) shop page for each merchant that is not verified.
        "INSERT INTO shop_pages (merchant_id, title, slug, draft_title) "
        "SELECT m.id, m.merchant_name, 'farm-' || m.id, m.merchant_name "
        "FROM merchants m WHERE m.verification_status <> 'verified' "
        "AND NOT EXISTS (SELECT 1 FROM shop_pages p WHERE p.merchant_id = m.id) "
        "AND NOT EXISTS (SELECT 1 FROM shop_pages p WHERE p.slug = 'farm-' || m.id)",
    ]


def upgrade() -> None:
    allowed = ", ".join(f"'{status}'" for status in STATUSES)
    op.add_column(
        "merchants",
        sa.Column(
            "verification_status",
            sa.String(32),
            nullable=False,
            server_default="setup",
        ),
    )
    op.create_check_constraint(
        "ck_merchants_verification_status",
        "merchants",
        f"verification_status IN ({allowed})",
    )
    op.create_index(
        op.f("ix_merchants_verification_status"), "merchants", ["verification_status"]
    )
    for column in _NOW_NULLABLE:
        op.alter_column("merchants", column, existing_type=sa.String(), nullable=True)

    for column in (
        sa.Column("bir_file_sha256", sa.String(64), nullable=True),
        sa.Column("ocr_bir_tin", sa.Text(), nullable=True),
        sa.Column("ocr_bir_tin_hmac", sa.String(64), nullable=True),
        sa.Column("ocr_bir_name", sa.Text(), nullable=True),
        sa.Column("ocr_bir_vat_status", sa.String(20), nullable=True),
        sa.Column("check_checklist", sa.JSON(), nullable=True),
        sa.Column("check_confirmations", sa.JSON(), nullable=True),
    ):
        op.add_column("merchant_applications", column)
    op.create_index(
        op.f("ix_merchant_applications_bir_file_sha256"),
        "merchant_applications",
        ["bir_file_sha256"],
    )

    op.create_table(
        "merchant_setup_reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "merchant_id",
            sa.Integer(),
            sa.ForeignKey("merchants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("day", sa.Integer(), nullable=False),
        sa.Column(
            "sent_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "merchant_id", "day", name="uq_merchant_setup_reminders_day"
        ),
    )
    op.create_index(
        op.f("ix_merchant_setup_reminders_merchant_id"),
        "merchant_setup_reminders",
        ["merchant_id"],
    )

    dialect = op.get_bind().dialect.name
    for statement in backfill_statements(dialect):
        op.execute(statement)


def downgrade() -> None:
    op.drop_index(
        op.f("ix_merchant_setup_reminders_merchant_id"),
        table_name="merchant_setup_reminders",
    )
    op.drop_table("merchant_setup_reminders")
    op.drop_index(
        op.f("ix_merchant_applications_bir_file_sha256"),
        table_name="merchant_applications",
    )
    for name in (
        "check_confirmations",
        "check_checklist",
        "ocr_bir_vat_status",
        "ocr_bir_name",
        "ocr_bir_tin_hmac",
        "ocr_bir_tin",
        "bir_file_sha256",
    ):
        op.drop_column("merchant_applications", name)
    # Merchants created before approval cannot exist without approval: remove
    # them (their applications keep everything that was entered).
    op.execute(
        "UPDATE merchant_applications SET merchant_id = NULL WHERE merchant_id IN "
        "(SELECT id FROM merchants WHERE verification_status IN "
        "('setup', 'under_review', 'needs_changes'))"
    )
    op.execute(
        "DELETE FROM shop_pages WHERE merchant_id IN (SELECT id FROM merchants "
        "WHERE verification_status IN ('setup', 'under_review', 'needs_changes'))"
    )
    op.execute(
        "DELETE FROM merchants WHERE verification_status IN "
        "('setup', 'under_review', 'needs_changes') AND NOT EXISTS "
        "(SELECT 1 FROM orders o WHERE o.merchant_id = merchants.id)"
    )
    op.drop_index(op.f("ix_merchants_verification_status"), table_name="merchants")
    op.drop_constraint("ck_merchants_verification_status", "merchants", type_="check")
    op.drop_column("merchants", "verification_status")

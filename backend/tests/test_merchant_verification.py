"""The merchant is created at onboarding and follows the application status.

* Submit now and Submit later both create the merchant (and a draft shop
  page) in the same transaction, linked by application.merchant_id.
* verification_status follows the application: pending_documents -> setup,
  submitted -> under_review, clarification / rejected -> needs_changes,
  approved -> verified, suspended -> suspended.
* Approval updates that merchant (reviewed fields, verified_by / _at); it
  does not create another, and it never publishes the shop.
* The migration backfill: existing merchants stay verified and public; open
  applications get a merchant with the mapped status.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.models.admin_audit_log import AdminAuditLog
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.shopPage import ShopPage
from app.models.statuses import APPLICATION_TO_VERIFICATION
from app.services.account_suspension import merchant_is_public
from tests.better_auth import make_user
from tests.test_onboarding_seller_types import (  # noqa: F401 - fixtures
    _env,
    _later,
    _review,
    _submit,
    applicant,
)


def _merchant(db) -> Merchant:
    return db.query(Merchant).one()


def test_mapping_covers_every_application_status() -> None:
    assert APPLICATION_TO_VERIFICATION == {
        "pending_documents": "setup",
        "submitted": "under_review",
        "clarification": "needs_changes",
        "rejected": "needs_changes",
        "approved": "verified",
        "suspended": "suspended",
    }


def test_submit_later_creates_the_merchant_and_a_draft_shop(db, applicant):  # noqa: F811
    assert _later(db, applicant).status_code == 200
    application = db.query(MerchantApplication).one()
    merchant = _merchant(db)
    assert application.merchant_id == merchant.id
    assert merchant.verification_status == "setup"
    assert merchant.merchant_name == "Bulacan Farm"
    page = db.query(ShopPage).one()
    assert page.merchant_id == merchant.id
    assert page.slug == "bulacan-farm"
    assert page.published_at is None
    # Reviewed fields wait for approval.
    assert merchant.rsbsa_document_path is None
    assert merchant.verified_at is None


def test_submit_now_creates_the_merchant_under_review(db, applicant):  # noqa: F811
    assert _submit(db, applicant).status_code == 200
    merchant = _merchant(db)
    assert merchant.verification_status == "under_review"
    assert db.query(MerchantApplication).one().merchant_id == merchant.id
    assert merchant.gov_id_document_path is None


def test_status_follows_every_decision(db, applicant):  # noqa: F811
    assert _later(db, applicant).status_code == 200
    application = db.query(MerchantApplication).one()
    merchant = _merchant(db)

    assert _submit(db, applicant).status_code == 200
    db.refresh(merchant)
    assert merchant.verification_status == "under_review"

    assert _review(db, application, "clarification").status_code == 200
    db.refresh(merchant)
    assert merchant.verification_status == "needs_changes"

    # The applicant may resubmit while the merchant exists (not verified).
    assert _submit(db, applicant).status_code == 200
    db.refresh(merchant)
    assert merchant.verification_status == "under_review"

    assert _review(db, application, "rejected").status_code == 200
    db.refresh(merchant)
    assert merchant.verification_status == "needs_changes"

    assert _submit(db, applicant).status_code == 200
    assert _review(db, application, "approved").status_code == 200
    db.refresh(merchant)
    assert merchant.verification_status == "verified"
    assert merchant.verified_at is not None
    assert merchant.verified_by_user_id is not None
    assert merchant.gov_id_document_path == "gov-id/x.pdf"
    assert db.query(Merchant).count() == 1
    # Approval never publishes: prices and stock may be stale by then.
    assert merchant.shop_page.published_at is None
    entry = db.query(AdminAuditLog).order_by(AdminAuditLog.id.desc()).first()
    assert entry.after["verification_status"] == "verified"
    assert entry.after["checklist_confirmations"]

    # A verified merchant cannot send the form again.
    assert _submit(db, applicant).status_code == 409

    assert _review(db, application, "suspended").status_code == 200
    db.refresh(merchant)
    assert merchant.verification_status == "suspended"
    assert merchant.suspended_at is not None


def test_contact_number_used_by_another_shop(db, applicant, merchant):  # noqa: F811
    merchant.contact_number = "+639171234567"
    db.commit()
    resp = _later(db, applicant)
    assert resp.status_code == 409
    assert "contact_number" in resp.json()["errors"]
    assert db.query(MerchantApplication).count() == 0


# --- migration backfill -------------------------------------------------------


def _migration():
    path = (
        Path(__file__).parents[1]
        / "alembic/versions/c3d5e7f9a1b4_merchant_verification_status.py"
    )
    spec = importlib.util.spec_from_file_location("verification_migration", path)
    assert spec and spec.loader
    mig = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mig)
    return mig


def _insert_application(db, user_id: int, status: str, number: str) -> None:
    db.execute(
        sa.text(
            "INSERT INTO merchant_applications (user_id, status, merchant_name, "
            "seller_type, contact_email, contact_number, region, province, city, "
            "address, postal_code, available_days, pin_confirmed, created_at, "
            "updated_at) VALUES (:user_id, :status, NULL, 'individual_farmer', "
            "'x@example.com', :number, 'Region III', 'Bulacan', 'Malolos', 'x', "
            "'3000', '[]', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ),
        {"user_id": user_id, "status": status, "number": number},
    )


def test_backfill_keeps_sellers_live_and_creates_merchants(db, merchant):  # noqa: F811
    # As before the migration: the approved merchant has no status yet.
    db.execute(sa.text("UPDATE merchants SET verification_status = 'setup'"))
    statuses = ("pending_documents", "submitted", "clarification", "rejected")
    for index, status in enumerate(statuses):
        user = make_user(db, f"applicant{index}@example.com")
        db.flush()
        # The first one reuses the approved merchant's number: left NULL.
        number = merchant.contact_number if index == 0 else f"+63917000000{index}"
        _insert_application(db, user.id, status, number)
    db.commit()

    for statement in _migration().backfill_statements("sqlite"):
        db.execute(sa.text(statement))
    db.commit()
    db.expire_all()

    assert _merchant_status(db, merchant.id) == "verified"
    public = db.query(Merchant.id).filter(merchant_is_public()).all()
    assert [row[0] for row in public] == [merchant.id]

    for application in db.query(MerchantApplication).all():
        created = db.get(Merchant, application.merchant_id)
        assert created is not None
        assert (
            created.verification_status
            == APPLICATION_TO_VERIFICATION[application.status]
        )
        assert created.merchant_name == "My farm"
        assert created.shop_page is not None
        assert created.shop_page.published_at is None
    first = db.query(MerchantApplication).filter_by(status="pending_documents").one()
    assert db.get(Merchant, first.merchant_id).contact_number is None


def _merchant_status(db, merchant_id: int) -> str:
    return db.get(Merchant, merchant_id).verification_status


@pytest.mark.parametrize("suspended", [True])
def test_backfill_keeps_suspended_merchants_suspended(db, merchant, suspended):  # noqa: F811
    db.execute(
        sa.text(
            "UPDATE merchants SET verification_status = 'setup', "
            "suspended_at = CURRENT_TIMESTAMP"
        )
    )
    db.commit()
    for statement in _migration().backfill_statements("sqlite"):
        db.execute(sa.text(statement))
    db.commit()
    db.expire_all()
    assert _merchant_status(db, merchant.id) == "suspended"

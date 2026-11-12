"""A5: the admin dashboard stats."""

from datetime import date

from app.models.merchant_application import MerchantApplication
from app.models.payout_batch import PayoutBatch
from tests.test_admin_orders import _order, _txn
from tests.test_audit_log import _client, _staff
from tests.test_reviews import _buyer, db, merchant  # noqa: F401 - fixtures


def _batch(db, merchant, status):
    batch = PayoutBatch(
        merchant_id=merchant.id,
        status=status,
        gross_amount=100,
        period_date=date(2026, 11, 1),
    )
    db.add(batch)
    db.commit()


def test_pending_work_counts(db, merchant):
    staff = _staff(db)
    applicants = [_buyer(db, email=f"applicant{i}@example.com")[0] for i in range(2)]
    db.add_all(
        [
            MerchantApplication(
                user_id=applicant.id,
                status=status,
                merchant_name="Farm",
                business_type="individual",
                contact_email="applicant@example.com",
                contact_number="639170000001",
                rsbsa_document_path="rsbsa/3.pdf",
                region="Region III",
                province="Bulacan",
                city="Malolos",
                address="Purok 4",
                postal_code="3000",
                delivery_time=2,
                delivery_price=50,
                price_range_min=10,
                price_range_max=100,
                available_days=["mon"],
            )
            for applicant, status in zip(
                applicants, ("submitted", "approved"), strict=True
            )
        ]
    )
    db.commit()
    for status in ("pending", "approved", "failed", "processing", "released"):
        _batch(db, merchant, status)
    buyer = _buyer(db, email="b@example.com")
    _txn(db, _order(db, merchant, buyer, "cancelled"), "refund_pending")
    _txn(db, _order(db, merchant, buyer, "cancelled"), "refunded")

    res = _client(db, staff).get("/admin/stats")
    assert res.status_code == 200, res.text
    assert res.json()["pending_work"] == {
        "applications": 1,
        "payouts_to_send": 3,
        "refunds_pending": 1,
    }


def test_stats_are_admin_only(db, merchant):
    buyer, _ = _buyer(db)
    assert _client(db, buyer).get("/admin/stats").status_code == 403

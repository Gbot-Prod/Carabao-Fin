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


def test_weekly_signups_buckets_by_manila_week(db, merchant):
    from datetime import UTC, datetime

    from app.api.routes.admin import WEEKS_SHOWN, _weekly_signups
    from app.models.user import User

    now = datetime(2026, 11, 12, 4, tzinfo=UTC)  # Thu 12 Nov, 12:00 in Manila
    # Sunday 8 Nov 17:00 UTC is Monday 9 Nov 01:00 in Manila: this week.
    this_week = datetime(2026, 11, 8, 17, tzinfo=UTC)
    last_week = datetime(2026, 11, 3, tzinfo=UTC)
    too_old = datetime(2026, 6, 1, tzinfo=UTC)
    for i, created in enumerate([this_week, this_week, last_week, too_old]):
        db.add(User(email=f"new{i}@example.com", created_at=created))
    db.add(User(email="staff@example.com", is_admin=True, created_at=this_week))
    merchant.created_at = this_week
    merchant.user.created_at = this_week  # has a merchant profile: not a buyer
    db.commit()

    weeks = _weekly_signups(db, now)
    assert len(weeks) == WEEKS_SHOWN
    assert weeks[-1] == {"week_start": "2026-11-09", "buyers": 2, "merchants": 1}
    assert weeks[-2] == {"week_start": "2026-11-02", "buyers": 1, "merchants": 0}
    assert weeks[0]["week_start"] == "2026-08-24"
    assert sum(w["buyers"] for w in weeks) == 3


def test_top_categories_from_paid_orders(db, merchant):
    from datetime import UTC, datetime, timedelta

    from app.api.routes.admin import _top_categories
    from app.models.produce import Produce

    def produce(name, category):
        row = Produce(
            merchant_id=merchant.id,
            name=name,
            price=10,
            stock_quantity=100,
            category=category,
        )
        db.add(row)
        db.commit()
        return row

    talong = produce("Talong", "Vegetables")
    mango = produce("Mango", "Fruits")
    odd = produce("Mystery", None)
    buyer = _buyer(db)
    now = datetime.now(UTC)

    def paid_order(items, status="paid", paid_days_ago=1):
        order = _order(db, merchant, buyer, items=items)
        txn = _txn(db, order, status)
        txn.paid_at = now - timedelta(days=paid_days_ago)
        db.commit()

    paid_order(
        [
            {"produce_id": talong.id, "quantity": 3, "price": 50},
            {"produceId": mango.id, "quantity": 1, "price": 200},
        ]
    )
    paid_order([{"id": talong.id, "quantity": 2, "price": 40}])
    paid_order([{"produce_id": odd.id, "quantity": 5, "price": 1}])
    paid_order([{"produce_id": 999, "quantity": 1, "price": 7}])  # deleted produce
    paid_order([{"produce_id": mango.id, "quantity": 9, "price": 999}], "pending")
    paid_order(
        [{"produce_id": mango.id, "quantity": 9, "price": 999}], paid_days_ago=40
    )

    result = _top_categories(db, now - timedelta(days=30))
    assert result == [
        {"category": "Vegetables", "revenue": 230, "quantity": 5},
        {"category": "Fruits", "revenue": 200, "quantity": 1},
        {"category": "Uncategorized", "revenue": 12, "quantity": 6},
    ]

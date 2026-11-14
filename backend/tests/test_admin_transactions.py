"""Admin transaction ledger: list, filters, totals, CSV export."""

import csv
import io
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin_transactions
from app.models.transaction import Transaction
from tests.test_admin_orders import _admin, _order
from tests.test_merchant_listings import _other_merchant
from tests.test_reviews import _buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user) -> TestClient:
    app = FastAPI()
    app.include_router(admin_transactions.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _txn(db, order, status, amount=500, fee=10, created_at=None, **extra):
    txn = Transaction(
        order_id=order.id,
        merchant_id=order.merchant_id,
        user_id=order.user_id,
        amount=amount,
        platform_fee=fee,
        merchant_amount=amount - fee,
        status=status,
        created_at=created_at or datetime(2026, 11, 10, 9, tzinfo=UTC),
        **extra,
    )
    db.add(txn)
    db.commit()
    return txn


def _ids(res):
    assert res.status_code == 200, res.text
    return sorted(t["id"] for t in res.json()["items"])


def test_non_admin_is_forbidden(db, merchant):
    buyer = _buyer(db)
    client = _client(db, buyer[0])
    assert client.get("/admin/transactions").status_code == 403
    assert client.get("/admin/transactions/export").status_code == 403


def test_lists_every_status_with_buyer_and_merchant(db, merchant):
    buyer = _buyer(db)
    order = _order(db, merchant, buyer)
    expired = _txn(db, order, "expired")
    paid = _txn(db, order, "paid", paymongo_payment_id="pay_abc123")
    client = _client(db, _admin(db))

    res = client.get("/admin/transactions")
    assert _ids(res) == sorted([expired.id, paid.id])
    row = next(t for t in res.json()["items"] if t["id"] == paid.id)
    assert row["merchant_name"] == "Dela Cruz Farm"
    assert row["buyer_email"] == "buyer@example.com"
    assert row["buyer_name"] == "Juan dela Cruz"
    assert row["paymongo_payment_id"] == "pay_abc123"


def test_filters_status_merchant_and_dates(db, merchant):
    buyer = _buyer(db)
    other = _other_merchant(db)
    o1 = _order(db, merchant, buyer)
    o2 = _order(db, other, buyer)
    a = _txn(db, o1, "paid", created_at=datetime(2026, 11, 1, 9, tzinfo=UTC))
    b = _txn(db, o1, "failed", created_at=datetime(2026, 11, 5, 9, tzinfo=UTC))
    c = _txn(db, o2, "paid", created_at=datetime(2026, 11, 9, 23, tzinfo=UTC))
    client = _client(db, _admin(db))

    assert _ids(client.get("/admin/transactions?status=paid")) == sorted([a.id, c.id])
    assert _ids(client.get(f"/admin/transactions?merchant_id={other.id}")) == [c.id]
    assert _ids(
        client.get("/admin/transactions?date_from=2026-11-02&date_to=2026-11-09")
    ) == sorted([b.id, c.id])


def test_search_by_paymongo_id_order_id_and_email(db, merchant):
    buyer = _buyer(db)
    other_buyer = _buyer(db, email="maria@example.com", name="Maria Santos")
    o1 = _order(db, merchant, buyer)
    o2 = _order(db, merchant, other_buyer)
    a = _txn(db, o1, "paid", paymongo_payment_id="pay_XYZ789")
    b = _txn(db, o2, "paid", paymongo_payment_id="pay_other")
    client = _client(db, _admin(db))

    assert _ids(client.get("/admin/transactions?q=xyz789")) == [a.id]
    assert _ids(client.get("/admin/transactions?q=maria@")) == [b.id]
    assert _ids(client.get(f"/admin/transactions?q=%23{o2.id}")) == [b.id]


def test_totals_cover_all_matches_not_just_the_page(db, merchant):
    buyer = _buyer(db)
    order = _order(db, merchant, buyer)
    for _ in range(3):
        _txn(db, order, "paid", amount=1000, fee=20)
    client = _client(db, _admin(db))

    body = client.get("/admin/transactions?status=paid&page_size=1").json()
    assert len(body["items"]) == 1
    assert body["total"] == 3
    assert body["totals"] == {
        "count": 3,
        "amount": 3000,
        "platform_fee": 60,
        "merchant_amount": 2940,
    }


def test_csv_export_respects_filters_and_escapes_formulas(db, merchant):
    buyer = _buyer(db, email="evil@example.com", name="=HYPERLINK(1)")
    order = _order(db, merchant, buyer)
    paid = _txn(db, order, "paid", paymongo_payment_id="pay_1")
    _txn(db, order, "expired")
    client = _client(db, _admin(db))

    res = client.get("/admin/transactions/export?status=paid")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert "attachment" in res.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(res.text)))
    assert [int(r["transaction_id"]) for r in rows] == [paid.id]
    assert rows[0]["paymongo_payment_id"] == "pay_1"
    assert rows[0]["buyer_name"] == "'=HYPERLINK(1)"

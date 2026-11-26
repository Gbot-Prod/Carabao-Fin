"""Every admin table has a search box (q=) and sorts on its columns
(sort=<key>&order=asc|desc): the tables that had neither, or only one."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import (
    admin,
    admin_audit,
    admin_orders,
    admin_penalties,
    admin_terms,
    admin_transactions,
)
from app.models.admin_audit_log import AdminAuditLog
from app.models.listing_penalty import ListingPenalty
from app.models.merchant import Merchant
from app.models.prohibited_term import ProhibitedTerm
from app.models.user import User
from tests.better_auth import make_user
from tests.shared_fixtures import _buyer
from tests.test_admin_orders import _order, _txn
from tests.test_merchant_listings import _other_merchant


def _client(db: Session) -> tuple[TestClient, User]:
    staff = make_user(db, "admin@example.com", name="Zed Admin", is_admin=True)
    db.add(staff)
    db.commit()
    app = FastAPI()
    for r in (
        admin.router,
        admin_audit.router,
        admin_orders.router,
        admin_penalties.router,
        admin_terms.router,
        admin_transactions.router,
    ):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: staff
    return TestClient(app), staff


def _priced(db: Session, merchant: Merchant, buyer: Any, price: int, *args: Any) -> Any:
    order = _order(db, merchant, buyer, *args)
    order.total_price = price
    db.commit()
    return order


def _ids(res: Any, key: str = "id") -> list[int]:
    assert res.status_code == 200, res.text
    body = res.json()
    rows = body["items"] if isinstance(body, dict) else body
    return [row[key] for row in rows]


def test_users_search_name_email_and_id(db: Session) -> None:
    client, staff = _client(db)
    maria = make_user(db, "maria@example.com", name="Maria Santos")
    ben = make_user(db, "ben@farm.ph", name="Ben")
    db.commit()

    assert _ids(client.get("/admin/users", params={"q": "santos"})) == [maria.id]
    assert _ids(client.get("/admin/users", params={"q": "FARM.PH"})) == [ben.id]
    assert _ids(client.get("/admin/users", params={"q": f"#{ben.id}"})) == [ben.id]
    # Wildcards are literal.
    assert _ids(client.get("/admin/users", params={"q": "%"})) == []
    assert staff.id in _ids(client.get("/admin/users"))


def test_merchants_search_name_and_city(db: Session, merchant: Merchant) -> None:
    client, _ = _client(db)
    other = _other_merchant(db)

    found = _ids(client.get("/admin/merchants", params={"q": other.merchant_name}))
    assert found == [other.id]
    by_city = _ids(client.get("/admin/merchants", params={"q": merchant.city}))
    assert merchant.id in by_city


def test_orders_sort_and_search(db: Session, merchant: Merchant) -> None:
    client, _ = _client(db)
    juan = _buyer(db)
    ana = _buyer(db, "ana@example.com", "Ana Reyes")
    other = _other_merchant(db)
    a = _priced(db, merchant, juan, 900)
    b = _priced(db, other, ana, 100)

    by_total = _ids(
        client.get("/admin/orders", params={"sort": "total", "order": "asc"})
    )
    assert by_total == [b.id, a.id]
    by_buyer = _ids(
        client.get("/admin/orders", params={"sort": "buyer", "order": "asc"})
    )
    assert by_buyer == [b.id, a.id]  # Ana before Juan
    assert _ids(client.get("/admin/orders", params={"q": "reyes"})) == [b.id]
    assert _ids(client.get("/admin/orders", params={"q": "other farm"})) == [b.id]
    assert _ids(client.get("/admin/orders", params={"q": f"#{a.id}"})) == [a.id]
    assert client.get("/admin/orders", params={"sort": "bogus"}).status_code == 422


def test_transactions_sort(db: Session, merchant: Merchant) -> None:
    client, _ = _client(db)
    buyer = _buyer(db)
    small = _txn(db, _priced(db, merchant, buyer, 100), "paid")
    big = _txn(db, _priced(db, merchant, buyer, 900), "paid")

    res = client.get("/admin/transactions", params={"sort": "amount", "order": "desc"})
    assert _ids(res) == [big.id, small.id]
    res = client.get("/admin/transactions", params={"sort": "amount", "order": "asc"})
    assert _ids(res) == [small.id, big.id]


def test_refunds_search_and_sort(db: Session, merchant: Merchant) -> None:
    client, _ = _client(db)
    juan = _buyer(db)
    ana = _buyer(db, "ana@example.com", "Ana Reyes")
    a = _txn(db, _priced(db, merchant, juan, 300, "cancelled"), "refund_pending")
    b = _txn(db, _priced(db, merchant, ana, 700, "cancelled"), "refund_pending")

    def ids(**params: Any) -> list[int]:
        return _ids(client.get("/admin/refunds", params=params), "transaction_id")

    assert ids() == [a.id, b.id]  # the queue: oldest first
    assert ids(sort="amount", order="desc") == [b.id, a.id]
    assert ids(q="ana") == [b.id]


def test_audit_log_search_and_sort(db: Session) -> None:
    client, staff = _client(db)
    rows = [
        AdminAuditLog(
            admin_id=staff.id,
            admin_email=email,
            action=action,
            target_type="user",
            target_id=target,
            created_at=datetime(2026, 11, day, tzinfo=UTC),
        )
        for email, action, target, day in (
            ("ana@carabao.ph", "user.suspend", 7, 1),
            ("zed@carabao.ph", "produce.hide", 9, 2),
        )
    ]
    db.add_all(rows)
    db.commit()

    assert _ids(client.get("/admin/audit-log")) == [rows[1].id, rows[0].id]
    by_admin = _ids(
        client.get("/admin/audit-log", params={"sort": "admin", "order": "asc"})
    )
    assert by_admin == [rows[0].id, rows[1].id]
    assert _ids(client.get("/admin/audit-log", params={"q": "zed@"})) == [rows[1].id]
    assert _ids(client.get("/admin/audit-log", params={"q": "suspend"})) == [rows[0].id]
    assert _ids(client.get("/admin/audit-log", params={"q": "#7"})) == [rows[0].id]


def test_terms_sort(db: Session) -> None:
    client, _ = _client(db)
    rows = [
        ProhibitedTerm(term="alpha", category="weapons", severity="soft_flag"),
        ProhibitedTerm(term="beta", category="drugs", severity="hard_block"),
    ]
    db.add_all(rows)
    db.commit()

    assert _ids(client.get("/admin/prohibited-terms")) == [rows[0].id, rows[1].id]
    res = client.get("/admin/prohibited-terms", params={"sort": "category"})
    assert _ids(res) == [rows[1].id, rows[0].id]


def test_penalties_search_and_sort(db: Session, merchant: Merchant) -> None:
    client, _ = _client(db)
    other = _other_merchant(db)
    now = datetime.now(UTC)
    rows = [
        ListingPenalty(
            merchant_id=m.id,
            produce_name=name,
            code="PROHIBITED_ITEM",
            points=points,
            created_at=now,
        )
        for m, name, points in ((merchant, "Talong", 1), (other, "Kamatis", 3))
    ]
    db.add_all(rows)
    db.commit()

    by_points = _ids(client.get("/admin/penalties", params={"sort": "points"}))
    assert by_points == [rows[1].id, rows[0].id]  # desc by default
    assert _ids(client.get("/admin/penalties", params={"q": "kamatis"})) == [rows[1].id]

    accounts = client.get("/admin/penalties/accounts", params={"sort": "points"})
    assert _ids(accounts, "merchant_id") == [other.id, merchant.id]
    res = client.get("/admin/penalties/accounts", params={"q": "other"})
    assert _ids(res, "merchant_id") == [other.id]


def test_disputes_search_and_sort(db: Session, merchant: Merchant) -> None:
    client, _ = _client(db)
    juan = _buyer(db)
    ana = _buyer(db, "ana@example.com", "Ana Reyes")
    first = _order(
        db,
        merchant,
        juan,
        "delivered",
        delivery_disputed_at=datetime(2026, 11, 1, tzinfo=UTC),
    )
    second = _order(
        db,
        merchant,
        ana,
        "delivered",
        delivery_disputed_at=datetime(2026, 11, 3, tzinfo=UTC),
    )

    def ids(**params: Any) -> list[int]:
        return _ids(client.get("/admin/disputes", params=params), "order_id")

    assert ids() == [first.id, second.id]  # open: oldest first
    assert ids(sort="disputed", order="desc") == [second.id, first.id]
    assert ids(q="reyes") == [second.id]

"""Admin tables sort on a column (sort=<key>&order=asc|desc), and the users
table shows only admins or only buyer and merchant accounts (role=)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin, admin_produce, admin_reviews
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.review import Review
from app.models.user import User
from tests.better_auth import make_user


def _client(db: Session) -> TestClient:
    staff = make_user(db, "admin@example.com", name="Zed Admin", is_admin=True)
    db.add(staff)
    db.commit()
    app = FastAPI()
    for r in (admin.router, admin_produce.router, admin_reviews.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: staff
    return TestClient(app)


def _second_merchant(db: Session, name: str = "Abaca Farm") -> Merchant:
    owner = make_user(db, "farmer2@example.com")
    db.add(owner)
    db.flush()
    row = Merchant(
        verification_status="verified",
        user_id=owner.id,
        merchant_name=name,
        contact_number="639171234568",
        region="Region III (Central Luzon)",
        province="Bulacan",
        city="Baliwag",
        address="Purok 2",
        postal_code="3006",
        available_days=["mon"],
        operating_hours={},
        rating=4.5,
        verified_at=datetime(2026, 10, 1, tzinfo=UTC),
    )
    db.add(row)
    db.commit()
    return row


def _ids(res: Any) -> list[int]:
    assert res.status_code == 200, res.text
    return [row["id"] for row in res.json()["items"]]


def test_users_role_filter_and_sort(db: Session) -> None:
    client = _client(db)
    buyers = [
        make_user(db, "maria@example.com", name="maria"),
        make_user(db, "ben@example.com", name="Ben"),
    ]
    db.commit()
    admin_id = next(u.id for u in db.query(User) if u.is_admin)

    admins = client.get("/admin/users", params={"role": "admin"}).json()
    assert [u["id"] for u in admins["items"]] == [admin_id]
    assert admins["total"] == 1
    users = client.get("/admin/users", params={"role": "user"}).json()
    assert {u["id"] for u in users["items"]} == {b.id for b in buyers}
    assert users["total"] == 2

    # Case-insensitive: Ben, maria, Zed Admin.
    by_name = _ids(client.get("/admin/users", params={"sort": "name"}))
    assert by_name == [buyers[1].id, buyers[0].id, admin_id]
    desc = _ids(client.get("/admin/users", params={"sort": "name", "order": "desc"}))
    assert desc == by_name[::-1]
    assert client.get("/admin/users", params={"role": "staff"}).status_code == 422
    assert client.get("/admin/users", params={"sort": "password"}).status_code == 422


def test_merchants_sort_by_approval_date_and_products(
    db: Session, merchant: Any
) -> None:
    other = _second_merchant(db)
    merchant.verified_at = datetime(2026, 11, 1, tzinfo=UTC)
    db.add_all(
        [Produce(merchant_id=merchant.id, name=f"P{i}", price=10) for i in range(2)]
    )
    db.commit()
    client = _client(db)

    approved = _ids(client.get("/admin/merchants", params={"sort": "approved"}))
    assert approved == [other.id, merchant.id]
    newest = client.get(
        "/admin/merchants", params={"sort": "approved", "order": "desc"}
    ).json()["items"]
    assert [m["id"] for m in newest] == [merchant.id, other.id]
    assert newest[0]["verified_at"].startswith("2026-11-01")

    products = _ids(
        client.get("/admin/merchants", params={"sort": "products", "order": "desc"})
    )
    assert products == [merchant.id, other.id]
    assert _ids(client.get("/admin/merchants", params={"sort": "name"})) == [
        other.id,
        merchant.id,
    ]


def test_merchants_without_approval_date_come_last(db: Session, merchant: Any) -> None:
    other = _second_merchant(db)
    client = _client(db)
    for order in ("asc", "desc"):
        res = client.get(
            "/admin/merchants", params={"sort": "approved", "order": order}
        )
        assert _ids(res) == [other.id, merchant.id]


def test_listings_sort_by_category_and_merchant(db: Session, merchant: Any) -> None:
    other = _second_merchant(db)
    rows = [
        Produce(
            merchant_id=merchant.id, name="Talong", category="Vegetables", price=80
        ),
        Produce(merchant_id=other.id, name="Mango", category="Fruits", price=120),
        Produce(merchant_id=merchant.id, name="Rice", category=None, price=50),
    ]
    db.add_all(rows)
    db.commit()
    client = _client(db)

    by_category = _ids(client.get("/admin/produce", params={"sort": "category"}))
    assert by_category == [rows[1].id, rows[0].id, rows[2].id]  # no category last
    by_merchant = _ids(client.get("/admin/produce", params={"sort": "merchant"}))
    assert by_merchant[0] == rows[1].id  # Abaca Farm before Dela Cruz Farm
    by_price = _ids(
        client.get("/admin/produce", params={"sort": "price", "order": "desc"})
    )
    assert by_price == [rows[1].id, rows[0].id, rows[2].id]
    # No sort: newest first, as before.
    assert _ids(client.get("/admin/produce")) == [r.id for r in rows][::-1]


def test_reviews_sort_by_rating_and_farm(db: Session, merchant: Any) -> None:
    other = _second_merchant(db)
    start = datetime(2026, 11, 1, tzinfo=UTC)
    rows = [
        Review(merchant_id=merchant.id, rating=5, created_at=start),
        Review(merchant_id=other.id, rating=1, created_at=start + timedelta(days=1)),
        Review(merchant_id=merchant.id, rating=3, created_at=start + timedelta(days=2)),
    ]
    db.add_all(rows)
    db.commit()
    client = _client(db)

    assert _ids(client.get("/admin/reviews")) == [rows[2].id, rows[1].id, rows[0].id]
    by_rating = _ids(
        client.get("/admin/reviews", params={"sort": "rating", "order": "asc"})
    )
    assert by_rating == [rows[1].id, rows[2].id, rows[0].id]
    by_farm = _ids(
        client.get("/admin/reviews", params={"sort": "farm", "order": "asc"})
    )
    assert by_farm == [rows[1].id, rows[0].id, rows[2].id]

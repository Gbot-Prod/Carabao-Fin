"""CF-0062 (B60): a slim, optionally windowed public farm list."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes import merchants
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.schemas.pagination import MAX_OFFSET
from tests.better_auth import make_user


def _client(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _farm(db: Session, n: int) -> Merchant:
    owner = make_user(db, f"farm{n}@example.com")
    db.add(owner)
    db.flush()
    farm = Merchant(
        user_id=owner.id,
        merchant_name=f"Farm {n}",
        contact_number=f"63917123456{n}",
        region="Region III",
        province="Bulacan",
        address="Purok 1",
        postal_code="3000",
        available_days=["mon"],
        operating_hours={},
        business_type="individual",
        rsbsa_document_path="rsbsa/1.pdf",
        gov_id_type="Passport",
        gov_id_document_path="gov-id/x.pdf",
    )
    db.add(farm)
    db.flush()
    for i in range(3):
        db.add(
            Produce(merchant_id=farm.id, name=f"Item {i}", price=10, stock_quantity=5)
        )
    db.commit()
    return farm


@contextmanager
def _count_queries(db: Session) -> Iterator[list[str]]:
    seen: list[str] = []
    engine: Any = db.get_bind()

    def before(_conn: Any, _cursor: Any, statement: str, *_: Any) -> None:
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", before)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", before)


def test_default_list_is_unchanged_for_the_mobile_app(db: Session) -> None:
    for n in range(2):
        _farm(db, n)
    rows = _client(db).get("/merchants").json()
    assert [r["merchant_name"] for r in rows] == ["Farm 0", "Farm 1"]
    assert all(len(r["produces"]) == 3 for r in rows)


def test_slim_list_sends_no_listings_and_does_not_load_them(db: Session) -> None:
    for n in range(2):
        _farm(db, n)
    client = _client(db)
    with _count_queries(db) as two_farms:
        rows = client.get("/merchants", params={"include_produce": "false"}).json()
    assert [r["produces"] for r in rows] == [[], []]
    assert all("Item" not in s for s in map(str, rows))
    assert not any("FROM produces" in q for q in two_farms)

    for n in range(2, 6):
        _farm(db, n)
    db.expire_all()
    with _count_queries(db) as six_farms:
        rows = client.get("/merchants", params={"include_produce": "false"}).json()
    assert len(rows) == 6
    # Same number of statements however many farms there are (no N+1).
    assert len(six_farms) == len(two_farms)


def test_window_is_oldest_first_and_bounded(db: Session) -> None:
    ids = [_farm(db, n).id for n in range(5)]
    client = _client(db)

    page = client.get("/merchants", params={"limit": 2, "offset": 2}).json()
    assert [r["id"] for r in page] == ids[2:4]
    tail = client.get("/merchants", params={"limit": 2, "offset": 4}).json()
    assert [r["id"] for r in tail] == ids[4:]

    for params in (
        {"limit": 0},
        {"limit": merchants.MAX_PUBLIC_FARMS_PAGE + 1},
        {"offset": -1},
        {"offset": MAX_OFFSET + 1},
        {"include_produce": "maybe"},
    ):
        assert client.get("/merchants", params=params).status_code == 422, params

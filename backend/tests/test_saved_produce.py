"""CF-0038: buyers save produce listings for later (wishlist)."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import saved_produce
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.saved_produce import SavedProduce
from app.models.user import User
from app.services.produce_freshness import ph_today
from tests.shared_fixtures import _buyer

TODAY = ph_today()


def _client(db: Session, user: User) -> TestClient:
    app = FastAPI()
    app.include_router(saved_produce.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _listing(
    db: Session, merchant: Merchant, name: str = "Tomato", **extra: Any
) -> Produce:
    fields: dict[str, object] = {
        "merchant_id": merchant.id,
        "name": name,
        "price": 50,
        "stock_quantity": 10,
        "harvest_date": TODAY - timedelta(days=1),
        "best_before": TODAY + timedelta(days=5),
        **extra,
    }
    produce = Produce(**fields)
    db.add(produce)
    db.commit()
    return produce


@pytest.fixture
def me(db: Session) -> User:
    return _buyer(db)[0]


def test_save_list_and_unsave(db: Session, merchant: Merchant, me: User) -> None:
    tomato = _listing(db, merchant)
    kale = _listing(db, merchant, "Kale")
    client = _client(db, me)

    assert client.put(f"/produce/{tomato.id}/save").status_code == 204
    assert client.put(f"/produce/{kale.id}/save").status_code == 204
    # Newest save first; the list carries the farm.
    db.query(SavedProduce).filter(SavedProduce.produce_id == tomato.id).update(
        {"created_at": datetime(2026, 1, 1, tzinfo=UTC)}
    )
    db.commit()

    assert client.get("/users/me/saved-produce/ids").json() == [kale.id, tomato.id]
    listed = client.get("/users/me/saved-produce").json()
    assert [row["id"] for row in listed] == [kale.id, tomato.id]
    assert listed[0]["merchant_name"] == "Dela Cruz Farm"
    assert listed[0]["merchant_province"] == "Bulacan"
    assert listed[0]["saved_at"]
    assert listed[0]["price"] == 50

    assert client.delete(f"/produce/{kale.id}/save").status_code == 204
    assert client.get("/users/me/saved-produce/ids").json() == [tomato.id]


def test_saving_twice_keeps_one_row(db: Session, merchant: Merchant, me: User) -> None:
    tomato = _listing(db, merchant)
    client = _client(db, me)
    for _ in range(2):
        assert client.put(f"/produce/{tomato.id}/save").status_code == 204
    assert db.query(SavedProduce).count() == 1


def test_unsaving_something_not_saved_is_fine(db: Session, me: User) -> None:
    assert _client(db, me).delete("/produce/999/save").status_code == 204


def test_lists_are_per_buyer(db: Session, merchant: Merchant, me: User) -> None:
    tomato = _listing(db, merchant)
    other = _buyer(db, email="other@example.com")[0]
    _client(db, other).put(f"/produce/{tomato.id}/save")
    assert _client(db, me).get("/users/me/saved-produce").json() == []
    assert _client(db, me).get("/users/me/saved-produce/ids").json() == []
    # Unsaving only touches your own row.
    _client(db, me).delete(f"/produce/{tomato.id}/save")
    assert db.query(SavedProduce).filter(SavedProduce.user_id == other.id).count() == 1


@pytest.mark.parametrize(
    "extra",
    [
        {"hidden_at": datetime(2026, 1, 1, tzinfo=UTC), "hidden_reason": "spam"},
        {
            "best_before": TODAY - timedelta(days=1),
            "harvest_date": TODAY - timedelta(days=9),
        },
    ],
)
def test_hidden_or_expired_listings_cannot_be_saved(
    db: Session, merchant: Merchant, me: User, extra: dict[str, Any]
) -> None:
    produce = _listing(db, merchant, **extra)
    assert _client(db, me).put(f"/produce/{produce.id}/save").status_code == 404
    assert db.query(SavedProduce).count() == 0


def test_saved_listing_that_is_hidden_later_drops_out_and_comes_back(
    db: Session, merchant: Merchant, me: User
) -> None:
    tomato = _listing(db, merchant)
    client = _client(db, me)
    client.put(f"/produce/{tomato.id}/save")

    tomato.hidden_at = datetime(2026, 1, 1, tzinfo=UTC)  # type: ignore[assignment]
    db.commit()
    assert client.get("/users/me/saved-produce").json() == []
    assert db.query(SavedProduce).count() == 1  # still saved

    tomato.hidden_at = None  # type: ignore[assignment]
    db.commit()
    assert [row["id"] for row in client.get("/users/me/saved-produce").json()] == [
        tomato.id
    ]


def test_suspended_farm_listings_drop_out(
    db: Session, merchant: Merchant, me: User
) -> None:
    tomato = _listing(db, merchant)
    client = _client(db, me)
    client.put(f"/produce/{tomato.id}/save")
    merchant.suspended_at = datetime(2026, 1, 1, tzinfo=UTC)  # type: ignore[assignment]
    db.commit()
    assert client.get("/users/me/saved-produce").json() == []
    assert client.put(f"/produce/{tomato.id}/save").status_code == 404


def test_merchant_cannot_save_own_listing(db: Session, merchant: Merchant) -> None:
    tomato = _listing(db, merchant)
    owner = db.get(User, merchant.user_id)
    assert owner is not None
    res = _client(db, owner).put(f"/produce/{tomato.id}/save")
    assert res.status_code == 400
    assert db.query(SavedProduce).count() == 0


def test_saved_list_is_capped(
    db: Session, merchant: Merchant, me: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(saved_produce, "MAX_SAVED", 2)
    items = [_listing(db, merchant, f"Item {i}") for i in range(3)]
    client = _client(db, me)
    assert client.put(f"/produce/{items[0].id}/save").status_code == 204
    assert client.put(f"/produce/{items[1].id}/save").status_code == 204
    res = client.put(f"/produce/{items[2].id}/save")
    assert res.status_code == 400
    assert "up to 2" in res.json()["detail"]
    # Re-saving one already saved is still fine at the cap.
    assert client.put(f"/produce/{items[0].id}/save").status_code == 204


def test_deleting_the_listing_removes_the_save(
    db: Session, merchant: Merchant, me: User
) -> None:
    tomato = _listing(db, merchant)
    _client(db, me).put(f"/produce/{tomato.id}/save")
    db.delete(tomato)
    db.commit()
    assert db.query(SavedProduce).count() == 0

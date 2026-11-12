"""U2: server-side produce search with filters, sorting, pagination and logging."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_db
from app.api.routes import produce_search
from app.models.produce import Produce
from app.models.search_log import SearchLog
from app.models.user import User
from app.services.produce_freshness import ph_today
from tests.test_merchant_listings import _other_merchant
from tests.test_reviews import db, merchant  # noqa: F401 - fixtures

TODAY = ph_today()


@pytest.fixture
def client(db):  # noqa: F811
    app = FastAPI()
    app.include_router(produce_search.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


@pytest.fixture
def listings(db, merchant):  # noqa: F811
    rival = _other_merchant(db)  # Bulacan; give it another province
    rival.province = "Pampanga"
    rows = {
        "talong": Produce(
            merchant_id=merchant.id,
            name="Talong",
            category="Vegetables",
            price=60,
            stock_quantity=10,
            harvest_date=TODAY - timedelta(2),
            best_before=TODAY + timedelta(5),
        ),
        "mango": Produce(
            merchant_id=rival.id,
            name="Carabao Mango",
            category="Fruits",
            price=150,
            stock_quantity=0,
            harvest_date=TODAY - timedelta(1),
            best_before=TODAY + timedelta(3),
        ),
        "undated": Produce(
            merchant_id=merchant.id,
            name="Kamatis",
            category="Vegetables",
            price=40,
            stock_quantity=5,
        ),
        "expired": Produce(
            merchant_id=merchant.id,
            name="Old Talong",
            category="Vegetables",
            price=10,
            stock_quantity=5,
            best_before=TODAY - timedelta(1),
        ),
        "hidden": Produce(
            merchant_id=merchant.id,
            name="Hidden Talong",
            category="Vegetables",
            price=20,
            stock_quantity=5,
            hidden_at=datetime.now(UTC),
        ),
    }
    db.add_all(rows.values())
    db.commit()
    return rows


def _names(res):
    assert res.status_code == 200, res.text
    return [p["name"] for p in res.json()["items"]]


def test_only_orderable_listings_are_returned(client, listings):
    names = _names(client.get("/produce/search"))
    assert set(names) == {"Talong", "Carabao Mango", "Kamatis"}


def test_text_matches_name_category_and_farm(client, listings):
    assert _names(client.get("/produce/search", params={"q": "talong"})) == ["Talong"]
    assert set(_names(client.get("/produce/search", params={"q": "fruit"}))) == {
        "Carabao Mango"
    }
    assert set(_names(client.get("/produce/search", params={"q": "dela cruz"}))) == {
        "Talong",
        "Kamatis",
    }
    assert (
        _names(client.get("/produce/search", params={"q": "100%"})) == []
    )  # LIKE chars escaped


def test_filters(client, listings):
    get = lambda **p: set(_names(client.get("/produce/search", params=p)))  # noqa: E731
    assert get(category="fruits") == {"Carabao Mango"}
    assert get(province="pampanga") == {"Carabao Mango"}
    assert get(min_price=50, max_price=100) == {"Talong"}
    assert get(in_stock=True) == {"Talong", "Kamatis"}
    assert get(fresh=True) == {"Talong", "Carabao Mango"}  # undated left out


def test_sorting_and_pagination(client, listings):
    assert _names(client.get("/produce/search", params={"sort": "price_asc"})) == [
        "Kamatis",
        "Talong",
        "Carabao Mango",
    ]
    assert (
        _names(client.get("/produce/search", params={"sort": "price_desc"}))[0]
        == "Carabao Mango"
    )
    assert (
        _names(client.get("/produce/search", params={"sort": "freshest"}))[0]
        == "Carabao Mango"
    )
    body = client.get(
        "/produce/search", params={"sort": "price_asc", "page": 2, "page_size": 2}
    ).json()
    assert body["total"] == 3 and [p["name"] for p in body["items"]] == [
        "Carabao Mango"
    ]
    assert body["items"][0]["merchant_name"] == "Other Farm"
    assert body["items"][0]["merchant_province"] == "Pampanga"
    assert client.get("/produce/search", params={"sort": "cheapest"}).status_code == 422


def test_suspended_merchant_is_left_out(db, client, listings, merchant):  # noqa: F811
    db.get(User, merchant.user_id).suspended_at = datetime.now(UTC)
    db.commit()
    assert set(_names(client.get("/produce/search"))) == {"Carabao Mango"}


def test_searches_are_logged_without_user(db, client, listings):  # noqa: F811
    client.get("/produce/search", params={"q": "  TALONG ", "province": "Bulacan"})
    client.get("/produce/search", params={"q": "talong", "page": 2})  # not logged twice
    client.get("/produce/search")  # empty query not logged
    [log] = db.query(SearchLog).all()
    assert (log.query, log.province, log.result_count) == ("talong", "Bulacan", 1)

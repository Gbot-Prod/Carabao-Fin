"""F3: demand insight (most-ordered and most-searched produce in the province)."""

from datetime import UTC, datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import demand_insight
from app.models.merchant import Merchant
from app.models.search_log import SearchLog
from app.models.user import User
from tests.test_merchant_sales import _order
from tests.test_reviews import _buyer, buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(demand_insight.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _other_farm(db, province):  # noqa: F811
    owner = User(email=f"farm-{province}@example.com")
    db.add(owner)
    db.flush()
    farm = Merchant(
        user_id=owner.id,
        merchant_name=f"{province} Farm",
        contact_number=f"6391700{len(province):05d}",
        region="Region III",
        province=province,
        address="Purok 2",
        postal_code="3000",
        available_days=["mon"],
        operating_hours={},
        price_range_min=10,
        price_range_max=100,
        business_type="individual",
        rsbsa_document_path="rsbsa/2.pdf",
    )
    db.add(farm)
    db.commit()
    return farm


def _search(db, query, province, results, days_ago=1):  # noqa: F811
    db.add(
        SearchLog(
            query=query,
            province=province,
            result_count=results,
            created_at=datetime.now(UTC) - timedelta(days=days_ago),
        )
    )
    db.commit()


def test_most_ordered_and_searched_in_province(db, merchant, buyer):  # noqa: F811
    neighbour = _other_farm(db, "bulacan")  # same province, different case
    far = _other_farm(db, "Batangas")
    talong = {"produce_id": 1, "name": "Talong", "quantity": 2, "price": 50}
    kamatis = {"produce_id": 2, "name": "Kamatis", "quantity": 5, "price": 40}
    _order(db, merchant, buyer, 100, [talong], 1)
    _order(db, neighbour, buyer, 100, [{**talong, "name": "talong"}, kamatis], 2)
    _order(db, far, buyer, 100, [kamatis, kamatis], 2)  # other province
    _order(db, merchant, buyer, 100, [kamatis], 40)  # too old
    _order(db, merchant, buyer, 100, [kamatis], 1, status="cancelled")

    _search(db, "sitaw", "Bulacan", 0)
    _search(db, "sitaw", "Bulacan", 0)
    _search(db, "talong", "Bulacan", 3)
    _search(db, "okra", "Batangas", 1)
    _search(db, "okra", None, 1)
    _search(db, "talong", "Bulacan", 3, days_ago=31)  # too old

    owner = db.get(User, merchant.user_id)
    data = _client(db, owner).get("/merchants/me/demand").json()
    assert data["province"] == "Bulacan" and data["days"] == 30
    assert [(p["name"], p["orders"], p["quantity"]) for p in data["most_ordered"]] == [
        ("Talong", 2, 4),
        ("Kamatis", 1, 5),
    ]
    assert [
        (s["query"], s["searches"], s["no_result_searches"])
        for s in data["most_searched"]
    ] == [("sitaw", 2, 2), ("talong", 1, 0)]
    luzon = {s["query"]: s["searches"] for s in data["most_searched_luzon"]}
    assert luzon == {"sitaw": 2, "okra": 2, "talong": 1}
    # No other farm or buyer is named anywhere in the response.
    assert "Farm" not in str(data) and "buyer@" not in str(data)


def test_non_merchant_gets_404(db):  # noqa: F811
    stranger, _ = _buyer(db, email="stranger@example.com")
    assert _client(db, stranger).get("/merchants/me/demand").status_code == 404

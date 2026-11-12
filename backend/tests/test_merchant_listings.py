"""The produce endpoints the web dashboard and mobile "My listings" share."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants
from app.models.merchant import Merchant
from app.models.produce import Produce
from app.models.user import User
from tests.test_reviews import db, merchant  # noqa: F401 - fixtures


def _client(db, user_id: int) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, user_id)
    return TestClient(app)


def _other_merchant(db) -> Merchant:
    owner = User(email="rival@example.com")
    db.add(owner)
    db.flush()
    other = Merchant(
        user_id=owner.id,
        merchant_name="Other Farm",
        contact_number="639170000000",
        region="Region III",
        province="Bulacan",
        address="Purok 2",
        postal_code="3000",
        available_days=["mon"],
        operating_hours={},
        price_range_min=10,
        price_range_max=100,
        business_type="individual",
        rsbsa_document_path="rsbsa/2.pdf",
    )
    db.add(other)
    db.commit()
    return other


def test_create_then_list_own_produce(db, merchant):  # noqa: F811
    client = _client(db, merchant.user_id)

    created = client.post(
        "/produce/", json={"name": "Talong", "price": 80, "stock_quantity": 12}
    )
    assert created.status_code == 200, created.text
    assert created.json()["merchant_id"] == merchant.id

    listed = client.get(f"/merchants/{merchant.id}/produce")
    assert [p["name"] for p in listed.json()] == ["Talong"]


def test_update_changes_only_sent_fields(db, merchant):  # noqa: F811
    produce = Produce(merchant_id=merchant.id, name="Kamatis", price=60, stock_quantity=5)
    db.add(produce)
    db.commit()

    res = _client(db, merchant.user_id).patch(
        f"/produce/{produce.id}", json={"price": 75}
    )

    assert res.status_code == 200, res.text
    assert res.json()["price"] == 75
    assert res.json()["stock_quantity"] == 5


def test_cannot_update_another_merchants_produce(db, merchant):  # noqa: F811
    other = _other_merchant(db)
    theirs = Produce(merchant_id=other.id, name="Sitaw", price=50, stock_quantity=3)
    db.add(theirs)
    db.commit()

    res = _client(db, merchant.user_id).patch(f"/produce/{theirs.id}", json={"price": 1})

    assert res.status_code == 404
    db.refresh(theirs)
    assert theirs.price == 50


def test_mobile_edit_form_payload_is_accepted(db, merchant):  # noqa: F811
    """The mobile form always sends all five fields; category may be cleared."""
    produce = Produce(
        merchant_id=merchant.id, name="Okra", price=40, stock_quantity=2, category="Vegetables"
    )
    db.add(produce)
    db.commit()

    res = _client(db, merchant.user_id).patch(
        f"/produce/{produce.id}",
        json={
            "name": "Okra (fresh)",
            "price": 45,
            "stock_quantity": 0,
            "unit": "lbs",
            "category": None,
        },
    )

    assert res.status_code == 200, res.text
    body = res.json()
    assert (body["name"], body["price"], body["stock_quantity"], body["unit"], body["category"]) == (
        "Okra (fresh)", 45, 0, "lbs", None,
    )

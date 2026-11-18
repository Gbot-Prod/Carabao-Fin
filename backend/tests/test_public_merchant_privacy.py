"""CF-0048 (B45): public farm routes don't send what can locate the owner.

``GET /merchants`` and ``GET /merchants/{id}`` are open to anyone. They leave
out the street address, barangay, map pin, legal business name and the owner's
user id; the farm contact number and email stay (the farm page and the mobile
farm screen show them). The owner reads the full profile from
``GET /merchants/me``.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants
from app.models.merchant import Merchant
from app.models.user import User
from tests.shared_fixtures import _buyer

PRIVATE = {"address", "barangay", "lat", "lng", "legal_business_name", "user_id"}


def _client(db: Session, user: User | None = None) -> TestClient:
    app = FastAPI()
    app.include_router(merchants.router)
    app.dependency_overrides[get_db] = lambda: db
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _with_home_details(db: Session, merchant: Merchant) -> None:
    db.query(Merchant).filter(Merchant.id == merchant.id).update(
        {
            "barangay": "San Isidro",
            "lat": 14.85,
            "lng": 120.81,
            "legal_business_name": "Juan Dela Cruz Farming",
            "contact_email": "farm@example.com",
        }
    )
    db.commit()
    db.refresh(merchant)


def test_public_list_and_detail_leave_out_home_details(
    db: Session, merchant: Merchant
) -> None:
    _with_home_details(db, merchant)
    client = _client(db)

    (row,) = client.get("/merchants").json()
    detail = client.get(f"/merchants/{merchant.id}").json()

    for body in (row, detail):
        assert PRIVATE.isdisjoint(body), sorted(PRIVATE & set(body))
        # What the farm page shows stays.
        assert body["merchant_name"] == "Dela Cruz Farm"
        assert body["contact_number"] == merchant.contact_number
        assert body["contact_email"] == "farm@example.com"
        assert body["province"] == "Bulacan"
        assert body["postal_code"] == "3000"
    assert "owner_name" in detail


def test_owner_reads_the_full_profile(db: Session, merchant: Merchant) -> None:
    _with_home_details(db, merchant)
    owner = db.get(User, merchant.user_id)
    assert owner is not None

    resp = _client(db, owner).get("/merchants/me")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == merchant.id
    assert body["address"] == "Purok 1"
    assert body["barangay"] == "San Isidro"
    assert (body["lat"], body["lng"]) == (14.85, 120.81)
    assert body["legal_business_name"] == "Juan Dela Cruz Farming"


def test_me_is_not_read_as_a_farm_id_and_needs_a_farm(
    db: Session, merchant: Merchant
) -> None:
    buyer, _ = _buyer(db)

    resp = _client(db, buyer).get("/merchants/me")

    # A buyer with no farm: 404 from the owner route, not 422 from {merchant_id}.
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Merchant profile not found"


def test_patch_me_still_returns_the_full_profile(
    db: Session, merchant: Merchant
) -> None:
    owner = db.get(User, merchant.user_id)
    assert owner is not None

    resp = _client(db, owner).patch(
        "/merchants/me", json={"merchant_name": "Bagong Ani"}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["merchant_name"] == "Bagong Ani"
    assert "address" in resp.json()

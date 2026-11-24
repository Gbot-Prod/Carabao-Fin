"""Guardrails Phase 2: check again after edits, new-farm review, penalty points."""

from datetime import UTC, datetime, timedelta

from app.api.routes import admin_penalties
from app.models.listing_penalty import ListingPenalty
from app.models.notification import Notification
from tests.test_produce_guardrails_api import _farmer, _payload, _staff


def _with_penalties(client):
    client.app.include_router(admin_penalties.router)
    return client


def _approve_three(db, farmer, staff):
    for name in ("Talong", "Ampalaya", "Okra"):
        listing = farmer.post("/produce/", json=_payload(name=name)).json()
        assert listing["review_flags"][-1]["code"] == "NEW_MERCHANT_REVIEW"
        assert staff.post(f"/admin/produce/{listing['id']}/approve").status_code == 200


def test_new_farm_listings_go_to_review_until_three_are_approved(db, merchant):
    farmer = _farmer(db, merchant)
    staff = _staff(db)
    first = farmer.post("/produce/", json=_payload()).json()
    assert first["status"] == "under_review"
    # A stock edit does not take it out of the review.
    edit = farmer.patch(f"/produce/{first['id']}", json={"stock_quantity": 5})
    assert edit.json()["status"] == "under_review"
    assert staff.post(f"/admin/produce/{first['id']}/approve").status_code == 200

    for name in ("Ampalaya", "Okra"):
        listing = farmer.post("/produce/", json=_payload(name=name)).json()
        staff.post(f"/admin/produce/{listing['id']}/approve")
    standing = farmer.get("/merchants/me/listing-standing").json()
    assert standing["new_merchant_reviews_left"] == 0
    assert (
        farmer.post("/produce/", json=_payload(name="Kalabasa")).json()["status"]
        == "live"
    )


def test_material_edit_with_a_flag_goes_back_to_review(db, merchant):
    farmer = _farmer(db, merchant)
    _approve_three(db, farmer, _staff(db))
    listing = farmer.post("/produce/", json=_payload(name="Sitaw")).json()
    assert listing["status"] == "live"
    url = f"/produce/{listing['id']}"

    # Stock only, and a small price change: no new review.
    assert farmer.patch(url, json={"stock_quantity": 3}).json()["status"] == "live"
    assert farmer.patch(url, json={"price": 90}).json()["status"] == "live"
    # A name the checker flags (category mismatch) sends it back.
    res = farmer.patch(url, json={"name": "Carabao Mango"}).json()
    assert res["status"] == "under_review"
    assert res["review_flags"][0]["code"] == "CATEGORY_MISMATCH"


def test_penalty_points_block_new_listings_and_notify_admins(db, merchant):
    farmer = _farmer(db, merchant)
    staff = _with_penalties(_staff(db))
    codes = staff.get("/admin/produce/rejection-codes").json()
    assert {c["code"]: c["points"] for c in codes}["PROHIBITED_COMMODITY"] == 3

    ids = [
        farmer.post("/produce/", json=_payload(name=name)).json()["id"]
        for name in ("Talong", "Okra")
    ]
    staff.post(f"/admin/produce/{ids[0]}/reject", json={"code": "INCORRECT_CATEGORY"})
    assert db.query(ListingPenalty).count() == 0  # an honest error: no points
    staff.post(f"/admin/produce/{ids[1]}/reject", json={"code": "PROHIBITED_COMMODITY"})

    standing = farmer.get("/merchants/me/listing-standing").json()
    assert standing["points"] == 3
    assert standing["can_create_listings"] is False
    blocked = farmer.post("/produce/", json=_payload(name="Kalabasa"))
    assert blocked.status_code == 403
    # Edits are still allowed.
    assert (
        farmer.patch(f"/produce/{ids[0]}", json={"stock_quantity": 1}).status_code
        == 200
    )
    kinds = {n.kind for n in db.query(Notification).all()}
    assert "listing_blocked" in kinds

    # Three more points: every admin is told to review the account.
    db.add(
        ListingPenalty(
            merchant_id=merchant.id,
            produce_name="Old",
            code="CONTACT_INFO",
            points=2,
            created_at=datetime.now(UTC) - timedelta(days=30),  # expired
        )
    )
    db.commit()
    third = farmer.patch(f"/produce/{ids[0]}", json={"name": "Sitaw"}).json()
    staff.post(
        f"/admin/produce/{third['id']}/reject", json={"code": "PROHIBITED_COMMODITY"}
    )
    accounts = staff.get("/admin/penalties/accounts").json()
    assert accounts[0]["points"] == 6
    assert accounts[0]["needs_account_review"] is True
    assert db.query(Notification).filter_by(kind="merchant_account_review").count() == 1

    # An admin removes points (appeal): the block lifts.
    rows = staff.get(f"/admin/penalties?merchant_id={merchant.id}&active=true").json()
    for row in rows["items"]:
        res = staff.post(
            f"/admin/penalties/{row['id']}/revoke", json={"reason": "Appeal accepted"}
        )
        assert res.status_code == 200, res.text
    assert farmer.get("/merchants/me/listing-standing").json()["points"] == 0

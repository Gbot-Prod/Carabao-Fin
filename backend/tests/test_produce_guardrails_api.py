"""Guardrails Phase 1: the checker on the listing routes, and the admin queue."""

from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin, admin_produce, admin_terms, merchants
from app.core.errors import FieldErrors, field_errors_handler
from app.models.admin_audit_log import AdminAuditLog
from app.models.notification import Notification
from app.models.produce import Produce
from app.models.prohibited_term import ProhibitedTerm
from app.models.user import User
from app.services import listing_checks, listing_trust
from app.services.produce_freshness import ph_today
from tests.better_auth import make_user

TODAY = ph_today()


@pytest.fixture(autouse=True)
def _trusted_merchant(monkeypatch):
    # These tests are about the checker; the new-farm review (Phase 2) is
    # tested in test_listing_trust.py.
    monkeypatch.setattr(listing_trust, "NEW_MERCHANT_REVIEW_COUNT", 0)


def _client(db, user=None) -> TestClient:
    app = FastAPI()
    for r in (admin.router, admin_produce.router, admin_terms.router, merchants.router):
        app.include_router(r)
    app.add_exception_handler(FieldErrors, field_errors_handler)
    app.dependency_overrides[get_db] = lambda: db
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _farmer(db, merchant) -> TestClient:
    return _client(db, db.get(User, merchant.user_id))


def _staff(db) -> TestClient:
    staff = make_user(
        db, "admin@example.com", is_admin=True, notifications_preferences={}
    )
    db.add(staff)
    db.commit()
    return _client(db, staff)


def _payload(**overrides):
    body = {
        "name": "Talong",
        "category": "Vegetables",
        "price": 80,
        "unit": "kg",
        "stock_quantity": 20,
        "harvest_date": (TODAY - timedelta(days=1)).isoformat(),
        "best_before": (TODAY + timedelta(days=5)).isoformat(),
    }
    body.update(overrides)
    return body


def test_check_reports_without_saving(db, merchant):
    farmer = _farmer(db, merchant)
    res = farmer.post(
        "/produce/check",
        json={"name": "Talong 09171234567", "category": "Fruits"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["valid"] is False
    assert body["hard_blocks"][0]["code"] == "CONTACT_INFO_DETECTED"
    assert body["soft_flags"][0]["suggestion"] == "Vegetables"
    assert db.query(Produce).count() == 0


def test_hard_block_refuses_the_save_with_field_errors(db, merchant):
    res = _farmer(db, merchant).post(
        "/produce/", json=_payload(description="PM me or GCash me")
    )
    assert res.status_code == 400
    errors = res.json()["errors"]
    assert set(errors) == {"description"}
    assert db.query(Produce).count() == 0


def test_clean_listing_goes_live_and_flagged_listing_goes_to_review(db, merchant):
    farmer = _farmer(db, merchant)
    live = farmer.post("/produce/", json=_payload()).json()
    assert live["status"] == "live"
    assert live["review_flags"] == []

    flagged = farmer.post(
        "/produce/", json=_payload(name="Carabao Mango", category="Vegetables")
    ).json()
    assert flagged["status"] == "under_review"
    assert flagged["review_flags"][0]["code"] == "CATEGORY_MISMATCH"
    assert flagged["submitted_for_review_at"] is not None

    # Buyers still see an under_review listing.
    public = _client(db).get(f"/merchants/{merchant.id}/produce").json()
    assert {p["status"] for p in public} == {"live", "under_review"}
    assert "review_flags" not in public[0]


def test_duplicate_listing_is_refused(db, merchant):
    farmer = _farmer(db, merchant)
    assert farmer.post("/produce/", json=_payload()).status_code == 200
    res = farmer.post("/produce/", json=_payload(name="  talong "))
    assert res.status_code == 400
    assert "name" in res.json()["errors"]
    # Listings are sold in kg only: pounds are refused.
    assert farmer.post("/produce/", json=_payload(unit="lbs")).status_code == 422


def test_edit_runs_the_checker_and_can_clear_a_review(db, merchant):
    farmer = _farmer(db, merchant)
    flagged = farmer.post(
        "/produce/", json=_payload(name="Carabao Mango", category="Vegetables")
    ).json()
    bad = farmer.patch(f"/produce/{flagged['id']}", json={"description": "fb page"})
    assert bad.status_code == 400
    fixed = farmer.patch(f"/produce/{flagged['id']}", json={"category": "Fruits"})
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["status"] == "live"
    # An edit of the same listing is not a duplicate of itself.
    assert (
        farmer.patch(f"/produce/{flagged['id']}", json={"price": 90}).status_code == 200
    )


def test_terms_from_the_table_are_used(db, merchant):
    db.add(
        ProhibitedTerm(
            term="lambanog", category="prohibited_commodity", severity="hard_block"
        )
    )
    db.commit()
    listing_checks.invalidate_terms_cache()
    res = _farmer(db, merchant).post("/produce/", json=_payload(name="Lambanog"))
    assert res.status_code == 400
    assert "lambanog" in res.json()["errors"]["name"]


def test_admin_approves_from_the_queue(db, merchant):
    farmer = _farmer(db, merchant)
    flagged = farmer.post(
        "/produce/", json=_payload(name="Carabao Mango", category="Vegetables")
    ).json()
    farmer.post("/produce/", json=_payload())
    staff = _staff(db)

    queue = staff.get("/admin/produce?status=under_review").json()
    assert [p["id"] for p in queue["items"]] == [flagged["id"]]
    assert queue["items"][0]["review_flags"][0]["code"] == "CATEGORY_MISMATCH"

    res = staff.post(f"/admin/produce/{flagged['id']}/approve")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "live"
    assert res.json()["review_flags"] == []
    assert staff.post(f"/admin/produce/{flagged['id']}/approve").status_code == 409

    note = db.query(Notification).filter_by(user_id=merchant.user_id).one()
    assert note.kind == "listing_approved"
    assert note.link == "/merchantDashboard"
    assert db.query(AdminAuditLog).one().action == "produce.approve"


def test_admin_rejects_and_merchant_sends_again(db, merchant):
    farmer = _farmer(db, merchant)
    flagged = farmer.post(
        "/produce/", json=_payload(name="Carabao Mango", category="Vegetables")
    ).json()
    staff = _staff(db)
    url = f"/admin/produce/{flagged['id']}/reject"
    assert staff.post(url, json={"code": "NOPE"}).status_code == 422
    assert staff.post(url, json={"code": "OTHER", "note": "short"}).status_code == 422

    res = staff.post(url, json={"code": "INCORRECT_CATEGORY", "note": "Use Fruits."})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"].endswith("Use Fruits.")

    # A rejected listing leaves the shop and cannot be ordered.
    assert _client(db).get(f"/merchants/{merchant.id}/produce").json() == []
    mine = farmer.get("/merchants/me/produce").json()
    assert mine[0]["rejection_code"] == "INCORRECT_CATEGORY"

    # The merchant edits it: it goes back to the queue, the reason is cleared.
    again = farmer.patch(f"/produce/{flagged['id']}", json={"category": "Fruits"})
    assert again.json()["status"] == "under_review"
    assert again.json()["rejection_code"] is None
    kinds = [n.kind for n in db.query(Notification).all()]
    assert kinds == ["listing_rejected"]


def test_hide_and_unhide_set_the_status(db, merchant):
    listing = _farmer(db, merchant).post("/produce/", json=_payload()).json()
    staff = _staff(db)
    hidden = staff.post(
        f"/admin/produce/{listing['id']}/hide", json={"reason": "Check photo"}
    )
    assert hidden.json()["status"] == "hidden"
    shown = staff.post(f"/admin/produce/{listing['id']}/unhide")
    assert shown.json()["status"] == "live"


def test_admin_manages_terms(db, merchant):
    staff = _staff(db)
    res = staff.post(
        "/admin/prohibited-terms",
        json={"term": "  Tuba  ", "category": "prohibited_commodity"},
    )
    assert res.status_code == 201, res.text
    term = res.json()
    assert term["term"] == "tuba"
    assert (
        staff.post(
            "/admin/prohibited-terms",
            json={"term": "TUBA", "category": "prohibited_commodity"},
        ).status_code
        == 409
    )
    farmer = _farmer(db, merchant)
    assert farmer.post("/produce/", json=_payload(name="Tuba")).status_code == 400

    off = staff.patch(
        f"/admin/prohibited-terms/{term['id']}", json={"is_active": False}
    )
    assert off.json()["is_active"] is False
    assert farmer.post("/produce/", json=_payload(name="Tuba")).status_code == 200
    listed = staff.get("/admin/prohibited-terms?active=false").json()
    assert listed["total"] == 1
    actions = [e.action for e in db.query(AdminAuditLog).order_by(AdminAuditLog.id)]
    assert actions == ["prohibited_term.create", "prohibited_term.update"]


def test_check_gives_the_ncr_market_price_and_the_recommendation(db, merchant):
    from app.models.reference_price import ReferencePrice

    db.add(
        ReferencePrice(
            commodity="Tomato",
            aliases="kamatis",
            unit="kg",
            low=110,
            high=120,
            source="DA Daily Price Index NCR",
            as_of=TODAY,
        )
    )
    db.commit()
    farmer = _farmer(db, merchant)

    body = farmer.post(
        "/produce/check",
        json={"name": "Kamatis", "price": 50, "unit": "kg", "unit_quantity": 0.5},
    ).json()
    market = body["market_price"]
    assert market["commodity"] == "Tomato"
    assert (market["low"], market["high"], market["recommended_max"]) == (110, 120, 110)
    assert market["price_per_kg"] == 100.0  # 50 pesos for 0.5 kg
    assert market["source"] == "DA Daily Price Index NCR"

    unknown = farmer.post("/produce/check", json={"name": "Durian"}).json()
    assert unknown["market_price"] is None

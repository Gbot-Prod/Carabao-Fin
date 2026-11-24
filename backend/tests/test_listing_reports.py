"""Guardrails Phase 3: buyer reports on listings, and the chat contact filter."""

from app.api.routes import listing_reports as listing_reports_routes
from app.models.listing_report import ListingReport
from app.models.notification import Notification
from app.services import listing_checks, listing_trust
from tests.test_produce_guardrails_api import _client, _farmer, _payload, _staff


def test_report_sends_listing_to_queue_until_an_admin_decides(
    db, merchant, buyer, monkeypatch
):
    monkeypatch.setattr(listing_trust, "NEW_MERCHANT_REVIEW_COUNT", 0)
    farmer = _farmer(db, merchant)
    staff = _staff(db)
    listing = farmer.post("/produce/", json=_payload()).json()
    assert listing["status"] == "live"
    url = f"/produce/{listing['id']}/report"

    shopper = _client(db, buyer[0])
    shopper.app.include_router(listing_reports_routes.router)
    assert shopper.post(url, json={"reason": "OTHER"}).status_code == 422
    assert shopper.post(url, json={"reason": "NOT_AS_DESCRIBED"}).status_code == 204
    assert shopper.post(url, json={"reason": "SPAM"}).status_code == 409
    farmer.app.include_router(listing_reports_routes.router)
    assert farmer.post(url, json={"reason": "SPAM"}).status_code == 400
    assert db.query(Notification).filter_by(kind="listing_reported").count() == 1

    # A merchant edit does not take the listing out of the queue.
    edited = farmer.patch(f"/produce/{listing['id']}", json={"price": 85}).json()
    assert edited["status"] == "under_review"
    assert edited["review_flags"][-1]["code"] == "BUYER_REPORT"

    queue = staff.get("/admin/produce", params={"status": "under_review"}).json()
    assert queue["items"][0]["open_reports"][0]["reason"] == "NOT_AS_DESCRIBED"
    assert staff.post(f"/admin/produce/{listing['id']}/approve").status_code == 200
    report = db.query(ListingReport).one()
    assert report.resolution == "approved"
    # The buyer can report it again after the decision.
    assert shopper.post(url, json={"reason": "SPAM"}).status_code == 204


def test_chat_refuses_contact_and_payment_details():
    problem = listing_checks.chat_message_problem
    assert problem("Text me at 0917 123 4567") == listing_checks.CHAT_CONTACT_MESSAGE
    assert problem("Add me on FB po") == listing_checks.CHAT_CONTACT_MESSAGE
    assert problem("GCash me na lang") == listing_checks.CHAT_PAYMENT_MESSAGE
    assert problem("Is the talong fresh? I need 3 kg on Monday.") is None

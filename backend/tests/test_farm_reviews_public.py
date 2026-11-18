"""CF-0046 (B48): public farm reviews page + buyer told about a farm reply.

The public list carries ``total`` so the farm page can page it. The buyer gets
one in-app notification, linked to the order, when the farm first replies;
editing the reply does not notify again.
"""

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes import reviews
from app.models.merchant import Merchant
from app.models.notification import Notification
from app.models.review import Review
from app.models.user import User
from app.services import notifications
from tests import test_reviews as tr
from tests.shared_fixtures import _buyer
from tests.test_merchant_listings import _other_merchant
from tests.test_review_replies import _owner, _url


def _public(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(reviews.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _reviews(db: Session, merchant: Merchant, count: int) -> list[Review]:
    for i in range(count):
        buyer = _buyer(db, f"b{i}@example.com", f"Buyer Number{i}")
        tr._review(
            tr._client(db, buyer[0]), tr._order(db, merchant, buyer), 5, f"Nice {i}"
        )
    return db.query(Review).order_by(Review.id).all()


def test_public_list_has_a_total_for_paging(db: Session, merchant: Merchant) -> None:
    _reviews(db, merchant, 3)
    client = _public(db)

    first = client.get(f"/merchants/{merchant.id}/reviews?limit=2").json()
    second = client.get(f"/merchants/{merchant.id}/reviews?limit=2&offset=2").json()

    assert first["total"] == second["total"] == 3
    assert len(first["reviews"]) == 2 and len(second["reviews"]) == 1
    seen = {r["id"] for r in first["reviews"]} | {r["id"] for r in second["reviews"]}
    assert len(seen) == 3
    # Public view: short name, no order link.
    assert first["reviews"][0]["reviewer_name"].endswith(".")
    assert "order_id" not in first["reviews"][0]


def test_total_counts_only_this_farm(db: Session, merchant: Merchant) -> None:
    _reviews(db, merchant, 2)
    other = _other_merchant(db)

    body = _public(db).get(f"/merchants/{other.id}/reviews").json()

    assert body["total"] == 0 and body["reviews"] == []


def _reply_notes(db: Session) -> list[Notification]:
    return (
        db.query(Notification)
        .filter(Notification.kind == notifications.REVIEW_REPLY)
        .all()
    )


def test_first_reply_notifies_the_buyer_once(db: Session, merchant: Merchant) -> None:
    (review,) = _reviews(db, merchant, 1)
    client = tr._client(db, _owner(db, merchant))

    assert client.put(_url(review), json={"reply": "Salamat po!"}).status_code == 200
    assert client.put(_url(review), json={"reply": "Salamat ulit!"}).status_code == 200

    notes = _reply_notes(db)
    assert len(notes) == 1
    (note,) = notes
    assert note.user_id == review.user_id
    assert note.title == f"{merchant.merchant_name} replied to your review"
    assert note.body == "Salamat po!"
    assert note.link == f"/orders/{review.order_id}"


def test_refused_reply_notifies_no_one(db: Session, merchant: Merchant) -> None:
    (review,) = _reviews(db, merchant, 1)
    buyer = db.get(User, review.user_id)
    assert buyer is not None
    owner = tr._client(db, _owner(db, merchant))

    # Not the farm's owner → 404; blank reply → 422. Neither notifies.
    resp = tr._client(db, buyer).put(_url(review), json={"reply": "Me"})
    assert resp.status_code == 404
    assert owner.put(_url(review), json={"reply": "   "}).status_code == 422
    assert _reply_notes(db) == []

"""CF-0043 (B11): the reviewed merchant can reply once to each review.

One reply per review (editable, removable), shown with the review in the
public list and the merchant's own list. Only the reviewed farm's owner can
write it; replying does not mark the buyer's review as edited.
"""

from typing import Any

from sqlalchemy.orm import Session

from app.models.merchant import Merchant
from app.models.review import Review
from app.models.user import User
from app.schemas.review import REPLY_MAX_LENGTH
from tests import test_reviews as tr
from tests.shared_fixtures import _buyer
from tests.test_merchant_listings import _other_merchant


def _reviewed(db: Session, merchant: Merchant) -> Review:
    buyer = _buyer(db)
    tr._review(tr._client(db, buyer[0]), tr._order(db, merchant, buyer), 4, "Fresh!")
    review = db.query(Review).one()
    return review


def _owner(db: Session, merchant: Merchant) -> User:
    owner = db.get(User, merchant.user_id)
    assert owner is not None
    return owner


def _url(review: Review) -> str:
    return f"/merchants/me/reviews/{review.id}/reply"


def test_owner_replies_edits_and_removes(db: Session, merchant: Merchant) -> None:
    review = _reviewed(db, merchant)
    before = review.updated_at
    client = tr._client(db, _owner(db, merchant))

    resp = client.put(_url(review), json={"reply": "  Salamat po!  "})
    assert resp.status_code == 200, resp.text
    body: dict[str, Any] = resp.json()
    assert body["merchant_reply"] == "Salamat po!"
    assert body["merchant_replied_at"] is not None
    # The buyer's review is not marked as edited by the reply.
    db.expire_all()
    assert db.get(Review, review.id).updated_at == before  # type: ignore[union-attr]

    edited = client.put(_url(review), json={"reply": "Salamat ulit!"})
    assert edited.json()["merchant_reply"] == "Salamat ulit!"

    assert client.delete(_url(review)).status_code == 204
    db.expire_all()
    gone = db.get(Review, review.id)
    assert gone is not None
    assert gone.merchant_reply is None and gone.merchant_replied_at is None
    # Idempotent.
    assert client.delete(_url(review)).status_code == 204


def test_reply_is_public_and_in_the_merchant_list(
    db: Session, merchant: Merchant
) -> None:
    review = _reviewed(db, merchant)
    owner_client = tr._client(db, _owner(db, merchant))
    owner_client.put(_url(review), json={"reply": "Thank you"})

    public = owner_client.get(f"/merchants/{merchant.id}/reviews").json()
    assert public["reviews"][0]["merchant_reply"] == "Thank you"
    mine = owner_client.get("/merchants/me/reviews").json()
    assert mine["reviews"][0]["merchant_reply"] == "Thank you"


def test_other_merchants_and_buyers_cannot_reply(
    db: Session, merchant: Merchant
) -> None:
    review = _reviewed(db, merchant)
    rival = _other_merchant(db)
    rival_owner = db.get(User, rival.user_id)
    assert rival_owner is not None
    reviewer = db.get(User, review.user_id)
    assert reviewer is not None

    # Another farm: same 404 as a missing review (no hint it exists).
    rival_client = tr._client(db, rival_owner)
    assert rival_client.put(_url(review), json={"reply": "x"}).status_code == 404
    assert rival_client.delete(_url(review)).status_code == 404
    # The buyer has no merchant profile.
    buyer_client = tr._client(db, reviewer)
    assert buyer_client.put(_url(review), json={"reply": "x"}).status_code == 404
    db.expire_all()
    assert db.get(Review, review.id).merchant_reply is None  # type: ignore[union-attr]


def test_reply_validation(db: Session, merchant: Merchant) -> None:
    review = _reviewed(db, merchant)
    client = tr._client(db, _owner(db, merchant))

    assert client.put(_url(review), json={"reply": "   "}).status_code == 422
    too_long = "a" * (REPLY_MAX_LENGTH + 1)
    assert client.put(_url(review), json={"reply": too_long}).status_code == 422
    extra = {"reply": "ok", "merchant_replied_at": "2020-01-01T00:00:00Z"}
    assert client.put(_url(review), json=extra).status_code == 422
    missing = client.put("/merchants/me/reviews/99999/reply", json={"reply": "ok"})
    assert missing.status_code == 404


def test_buyer_edit_keeps_the_reply(db: Session, merchant: Merchant) -> None:
    review = _reviewed(db, merchant)
    tr._client(db, _owner(db, merchant)).put(_url(review), json={"reply": "Thanks"})
    reviewer = db.get(User, review.user_id)
    assert reviewer is not None
    assert review.order_id is not None

    resp = tr._client(db, reviewer).patch(
        f"/orders/me/{review.order_id}/review", json={"rating": 5}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["merchant_reply"] == "Thanks"

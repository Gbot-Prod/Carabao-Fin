"""CF-0075 (B22): admins hide and restore reviews; hidden ones leave the
public list, the farm's list and the rating, with an audit row each time."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin_reviews, reviews
from app.models.admin_audit_log import AdminAuditLog
from app.models.merchant import Merchant
from app.models.review import Review
from app.models.user import User
from tests.shared_fixtures import _buyer
from tests.test_admin_orders import _admin
from tests.test_reviews import _client as _buyer_client
from tests.test_reviews import _order


def _admin_client(db: Session, user: User) -> TestClient:
    app = FastAPI()
    app.include_router(admin_reviews.router)
    app.include_router(reviews.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _two_reviews(db: Session, merchant: Any) -> tuple[Review, Review]:
    made = []
    for email, stars, text in (
        ("a@example.com", 5, "great"),
        ("b@example.com", 1, "SPAM visit x.example"),
    ):
        buyer = _buyer(db, email)
        order = _order(db, merchant, buyer)
        res = _buyer_client(db, buyer[0]).post(
            f"/orders/me/{order.id}/review", json={"rating": stars, "comment": text}
        )
        assert res.status_code in (200, 201), res.text
        made.append(db.query(Review).filter(Review.order_id == order.id).one())
    return made[0], made[1]


def test_hide_and_restore(db: Session, merchant: Any) -> None:
    good, spam = _two_reviews(db, merchant)
    edited_at = spam.updated_at
    admin = _admin(db)
    client = _admin_client(db, admin)
    assert db.get(Merchant, merchant.id).rating == 3.0  # type: ignore[union-attr]

    res = client.post(f"/admin/reviews/{spam.id}/hide", json={"reason": "spam link"})

    assert res.status_code == 200, res.text
    assert res.json()["hidden_reason"] == "spam link"
    public = client.get(f"/merchants/{merchant.id}/reviews").json()
    assert [r["id"] for r in public["reviews"]] == [good.id]
    db.expire_all()
    farm: Any = db.get(Merchant, merchant.id)
    assert (farm.rating, farm.rating_count) == (5.0, 1)
    stored: Any = db.get(Review, spam.id)
    assert stored.updated_at == edited_at  # not shown as a buyer edit
    assert stored.hidden_by == admin.id
    assert (
        client.post(f"/admin/reviews/{spam.id}/hide", json={"reason": "x"}).status_code
        == 409
    )

    res = client.post(f"/admin/reviews/{spam.id}/unhide")
    assert res.status_code == 200 and res.json()["hidden_at"] is None
    db.expire_all()
    farm = db.get(Merchant, merchant.id)
    assert (farm.rating, farm.rating_count) == (3.0, 2)
    actions = [a.action for a in db.query(AdminAuditLog).order_by(AdminAuditLog.id)]
    assert actions == ["review.hide", "review.unhide"]
    assert client.post(f"/admin/reviews/{spam.id}/unhide").status_code == 409


def test_farm_does_not_see_a_hidden_review(db: Session, merchant: Any) -> None:
    _, spam = _two_reviews(db, merchant)
    _admin_client(db, _admin(db)).post(
        f"/admin/reviews/{spam.id}/hide", json={"reason": "abuse"}
    )
    owner: Any = db.get(User, merchant.user_id)

    mine = _admin_client(db, owner).get("/merchants/me/reviews").json()

    assert [r["rating"] for r in mine["reviews"]] == [5]
    assert mine["total"] == 1
    assert mine["rating_breakdown"]["1"] == 0  # the hidden 1-star is not counted
    assert mine["rating_breakdown"]["5"] == 1
    assert mine["with_comment_count"] == 1
    assert (mine["rating"], mine["rating_count"]) == (5.0, 1)


def test_queue_filters_and_bounds(db: Session, merchant: Any) -> None:
    good, spam = _two_reviews(db, merchant)
    client = _admin_client(db, _admin(db))

    low = client.get("/admin/reviews", params={"max_rating": 2}).json()
    assert [r["id"] for r in low["items"]] == [spam.id] and low["total"] == 1
    assert low["items"][0]["reviewer_name"]  # first name + initial, not the email
    assert "@" not in low["items"][0]["reviewer_name"]
    found = client.get("/admin/reviews", params={"q": "spam"}).json()
    assert [r["id"] for r in found["items"]] == [spam.id]
    client.post(f"/admin/reviews/{spam.id}/hide", json={"reason": "spam"})
    assert [
        r["id"]
        for r in client.get("/admin/reviews", params={"hidden": True}).json()["items"]
    ] == [spam.id]
    assert [
        r["id"]
        for r in client.get("/admin/reviews", params={"hidden": False}).json()["items"]
    ] == [good.id]
    for params in ({"max_rating": 0}, {"max_rating": 6}, {"page_size": 101}):
        assert client.get("/admin/reviews", params=params).status_code == 422


def test_bad_input_and_non_admins(db: Session, merchant: Any) -> None:
    _, spam = _two_reviews(db, merchant)
    admin = _admin_client(db, _admin(db))
    for body in (
        {},
        {"reason": ""},
        {"reason": "   "},
        {"reason": "x" * 501},
        {"reason": "ok", "extra": 1},
    ):
        assert (
            admin.post(f"/admin/reviews/{spam.id}/hide", json=body).status_code == 422
        ), body
    assert (
        admin.post("/admin/reviews/999999/hide", json={"reason": "x"}).status_code
        == 404
    )

    buyer, _ = _buyer(db, "c@example.com")
    owner: Any = db.get(User, merchant.user_id)
    for user in (buyer, owner):
        client = _admin_client(db, user)
        assert client.get("/admin/reviews").status_code == 403
        assert (
            client.post(
                f"/admin/reviews/{spam.id}/hide", json={"reason": "x"}
            ).status_code
            == 403
        )
    db.expire_all()
    assert db.get(Review, spam.id).hidden_at is None  # type: ignore[union-attr]


def test_farm_cannot_reply_to_a_hidden_review(db: Session, merchant: Any) -> None:
    """CF-0078 (B86)."""
    _, spam = _two_reviews(db, merchant)
    _admin_client(db, _admin(db)).post(
        f"/admin/reviews/{spam.id}/hide", json={"reason": "abuse"}
    )
    owner: Any = db.get(User, merchant.user_id)
    farm = _admin_client(db, owner)

    put = farm.put(f"/merchants/me/reviews/{spam.id}/reply", json={"reply": "Hi!"})
    gone = farm.delete(f"/merchants/me/reviews/{spam.id}/reply")

    assert (put.status_code, gone.status_code) == (404, 404)
    db.expire_all()
    assert db.get(Review, spam.id).merchant_reply is None  # type: ignore[union-attr]


def test_the_author_sees_that_the_review_is_hidden(db: Session, merchant: Any) -> None:
    """CF-0078 (B87): a flag only; the admin's reason is not shown."""
    buyer = _buyer(db, "author@example.com")
    order = _order(db, merchant, buyer)
    client = _buyer_client(db, buyer[0])
    client.post(f"/orders/me/{order.id}/review", json={"rating": 1, "comment": "x"})
    review = db.query(Review).filter(Review.order_id == order.id).one()
    assert client.get(f"/orders/me/{order.id}/review").json()["hidden"] is False

    _admin_client(db, _admin(db)).post(
        f"/admin/reviews/{review.id}/hide", json={"reason": "secret note"}
    )

    mine = client.get(f"/orders/me/{order.id}/review")
    assert mine.json()["hidden"] is True
    assert "secret note" not in mine.text
    assert "hidden_reason" not in mine.json()

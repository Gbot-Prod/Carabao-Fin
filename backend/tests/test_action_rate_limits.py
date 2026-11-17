"""CF-0037: rate limits on review writes, chat messages and produce search.

Each test shrinks the scope's limit so a few requests reach it, then checks
the 429 body and Retry-After, that rejected requests changed nothing, and
that the count is per user (per IP for search).
"""

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import chat as chat_routes
from app.api.routes import produce_search, support_chat
from app.models.chat import ChatMessage
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.review import Review
from app.models.search_log import SearchLog
from app.models.user import User
from app.services import rate_limit
from tests.shared_fixtures import _buyer
from tests.test_reviews import _client as _review_client
from tests.test_reviews import _order as _delivered_order


def _shrink(monkeypatch: pytest.MonkeyPatch, scope: str, max_hits: int) -> None:
    monkeypatch.setitem(rate_limit.ACTION_LIMITS, scope, rate_limit.Limit(max_hits, 60))


def _app(db: Session, user: User | None, *routers: object) -> TestClient:
    app = FastAPI()
    for router in routers:
        app.include_router(router)  # type: ignore[arg-type]
    app.dependency_overrides[get_db] = lambda: db
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _assert_limited(res: object) -> None:
    assert res.status_code == 429  # type: ignore[attr-defined]
    assert res.json()["detail"].startswith("Too many requests.")  # type: ignore[attr-defined]
    assert int(res.headers["Retry-After"]) >= 1  # type: ignore[attr-defined]


def _active_order(db: Session, user: User, merchant: Merchant) -> Order:
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status="processing",
        total_price=500,
        items=[],
        ordered_at=datetime(2026, 11, 12, tzinfo=UTC),
    )
    db.add(order)
    db.commit()
    return order


# --- reviews ------------------------------------------------------------------


def test_review_writes_are_limited_per_buyer(
    db: Session, merchant: Merchant, monkeypatch: pytest.MonkeyPatch
) -> None:
    _shrink(monkeypatch, "review_write", 2)
    buyer = _buyer(db)
    user, _ = buyer
    orders = [_delivered_order(db, merchant, buyer) for _ in range(3)]
    client = _review_client(db, user)

    first = client.post(f"/orders/me/{orders[0].id}/review", json={"rating": 5})
    edit = client.patch(f"/orders/me/{orders[0].id}/review", json={"rating": 4})
    blocked = client.post(f"/orders/me/{orders[1].id}/review", json={"rating": 1})

    assert (first.status_code, edit.status_code) == (201, 200)
    _assert_limited(blocked)
    assert db.query(Review).count() == 1

    # Another buyer has their own count.
    other = _buyer(db, email="maria@example.com")
    theirs = _delivered_order(db, merchant, other)
    res = _review_client(db, other[0]).post(
        f"/orders/me/{theirs.id}/review", json={"rating": 3}
    )
    assert res.status_code == 201


def test_review_limit_counts_edits_too(
    db: Session, merchant: Merchant, monkeypatch: pytest.MonkeyPatch
) -> None:
    _shrink(monkeypatch, "review_write", 3)
    buyer = _buyer(db)
    order = _delivered_order(db, merchant, buyer)
    client = _review_client(db, buyer[0])
    assert (
        client.post(f"/orders/me/{order.id}/review", json={"rating": 5}).status_code
        == 201
    )
    for rating in (4, 3):
        assert (
            client.patch(
                f"/orders/me/{order.id}/review", json={"rating": rating}
            ).status_code
            == 200
        )
    _assert_limited(client.patch(f"/orders/me/{order.id}/review", json={"rating": 1}))
    assert db.query(Review).one().rating == 3


# --- order chat ---------------------------------------------------------------


def test_order_chat_messages_are_limited_per_sender(
    db: Session, merchant: Merchant, monkeypatch: pytest.MonkeyPatch
) -> None:
    _shrink(monkeypatch, "order_chat_send", 3)
    user, _ = _buyer(db)
    order = _active_order(db, user, merchant)
    buyer = _app(db, user, chat_routes.router)

    for i in range(3):
        res = buyer.post(f"/orders/{order.id}/messages", json={"body": f"hi {i}"})
        assert res.status_code == 200, res.text
    _assert_limited(buyer.post(f"/orders/{order.id}/messages", json={"body": "spam"}))
    assert db.query(ChatMessage).count() == 3

    # The farm can still answer.
    farm = _app(db, db.get(User, merchant.user_id), chat_routes.router)
    assert (
        farm.post(f"/orders/{order.id}/messages", json={"body": "ok"}).status_code
        == 200
    )


# --- support chat -------------------------------------------------------------


def test_support_messages_are_limited_per_user(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _shrink(monkeypatch, "support_chat_send", 2)
    user, _ = _buyer(db)
    me = _app(db, user, support_chat.router)

    for body in ("help", "still help"):
        assert me.post("/support/messages", json={"body": body}).status_code == 200
    _assert_limited(me.post("/support/messages", json={"body": "again"}))
    assert db.query(ChatMessage).count() == 2

    other, _ = _buyer(db, email="other@example.com")
    them = _app(db, other, support_chat.router)
    assert them.post("/support/messages", json={"body": "hello"}).status_code == 200


# --- produce search -----------------------------------------------------------


def test_search_is_limited_per_client_ip(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _shrink(monkeypatch, "produce_search", 2)
    monkeypatch.setenv("RATE_LIMIT_TRUST_PROXY", "true")
    client = _app(db, None, produce_search.router)
    a = {"X-Forwarded-For": "203.0.113.5"}
    b = {"X-Forwarded-For": "198.51.100.7"}

    for _ in range(2):
        assert (
            client.get("/produce/search", params={"q": "x"}, headers=a).status_code
            == 200
        )
    _assert_limited(client.get("/produce/search", params={"q": "x"}, headers=a))
    # A blocked search is not logged.
    assert db.query(SearchLog).count() == 2
    # Another client is unaffected.
    assert (
        client.get("/produce/search", params={"q": "x"}, headers=b).status_code == 200
    )


def test_default_limits_are_generous_for_people() -> None:
    limits = rate_limit.ACTION_LIMITS
    assert limits["produce_search"].max_hits >= 60
    assert limits["order_chat_send"].max_hits >= 20
    assert limits["review_write"].max_hits >= 5
    # Old hits are purged only after the longest window has passed.
    assert rate_limit.longest_window_seconds() >= max(
        limit.window_seconds for limit in limits.values()
    )

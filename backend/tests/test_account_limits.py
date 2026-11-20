"""CF-0054: notification preferences are typed (B49); follows are capped and
rate limited (B52)."""

from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.api.routes import follows
from app.models.farm_follow import FarmFollow
from app.models.merchant import Merchant
from app.models.user import User
from app.services.rate_limit import ACTION_LIMITS
from tests.shared_fixtures import _buyer
from tests.test_follows import _client as _follow_client
from tests.test_merchant_listings import _other_merchant
from tests.test_route_ownership import _client


@pytest.mark.parametrize(
    "prefs",
    [
        {"sms": False},
        {"order_updates": "no"},
        {"order_updates": {"nested": True}},
        {"email_alerts": False, "marketing": True},
    ],
)
def test_unknown_or_non_bool_preferences_are_refused(
    db: Session, prefs: dict[str, Any]
) -> None:
    user, _ = _buyer(db)

    resp = _client(db, user, follows_users_router()).patch(
        "/users/me", json={"notifications_preferences": prefs}
    )

    assert resp.status_code == 422, resp.text
    db.expire_all()
    assert db.get(User, user.id).notifications_preferences == {}  # type: ignore[union-attr]


def test_known_preferences_are_saved_as_sent(db: Session) -> None:
    user, _ = _buyer(db)

    resp = _client(db, user, follows_users_router()).patch(
        "/users/me", json={"notifications_preferences": {"order_updates": False}}
    )

    assert resp.status_code == 200, resp.text
    # Only the key that was sent; nothing filled in with None.
    assert resp.json()["notifications_preferences"] == {"order_updates": False}


def follows_users_router() -> Any:
    from app.api.routes import users

    return users.router


def test_follow_cap(
    db: Session, merchant: Merchant, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(follows, "MAX_FOLLOWS", 1)
    other = _other_merchant(db)
    user, _ = _buyer(db)
    client = _follow_client(db, user)

    assert client.put(f"/merchants/{merchant.id}/follow").status_code == 204
    # Following the same farm again is not a new follow.
    assert client.put(f"/merchants/{merchant.id}/follow").status_code == 204
    resp = client.put(f"/merchants/{other.id}/follow")
    assert resp.status_code == 409
    assert "up to 1 farms" in resp.json()["detail"]
    assert db.query(FarmFollow).filter(FarmFollow.user_id == user.id).count() == 1
    # Unfollowing frees the place.
    assert client.delete(f"/merchants/{merchant.id}/follow").status_code == 204
    assert client.put(f"/merchants/{other.id}/follow").status_code == 204


def test_follow_and_unfollow_are_rate_limited_per_user(
    db: Session, merchant: Merchant
) -> None:
    user, _ = _buyer(db, "busy@example.com")
    other, _ = _buyer(db, "calm@example.com")
    client = _follow_client(db, user)
    limit = ACTION_LIMITS["farm_follow"].max_hits

    for i in range(limit):
        verb = client.put if i % 2 == 0 else client.delete
        assert verb(f"/merchants/{merchant.id}/follow").status_code == 204
    resp = client.put(f"/merchants/{merchant.id}/follow")
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers
    calm = _follow_client(db, other)
    assert calm.put(f"/merchants/{merchant.id}/follow").status_code == 204


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("POST", "/users/me/delete-code", {"password": None, "skip_sms": True}),
        ("DELETE", "/users/me", {"code": "123456", "force": True}),
    ],
)
def test_account_delete_bodies_refuse_unknown_fields(
    db: Session, method: str, path: str, body: dict[str, Any]
) -> None:
    """CF-0085: the two account-deletion bodies (from main) refuse unknown
    fields, as the other input models do (CF-0051, CF-0063). The user is kept."""
    user, _ = _buyer(db)

    resp = _client(db, user, follows_users_router()).request(method, path, json=body)

    assert resp.status_code == 422, resp.text
    db.expire_all()
    assert db.get(User, user.id) is not None

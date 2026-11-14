"""U4: buyers follow farms."""


from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import follows
from app.models.farm_follow import FarmFollow
from app.models.user import User
from tests.better_auth import make_user, set_identity
from tests.test_merchant_listings import _other_merchant
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures


def _client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(follows.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_follow_list_and_unfollow(db, merchant, buyer):  # noqa: F811
    rival = _other_merchant(db)
    client = _client(db, buyer[0])

    assert client.put(f"/merchants/{merchant.id}/follow").status_code == 204
    assert client.put(f"/merchants/{rival.id}/follow").status_code == 204
    assert client.put(f"/merchants/{rival.id}/follow").status_code == 204  # idempotent
    assert db.query(FarmFollow).count() == 2
    assert set(client.get("/users/me/follows").json()) == {merchant.id, rival.id}

    assert client.delete(f"/merchants/{merchant.id}/follow").status_code == 204
    assert (
        client.delete(f"/merchants/{merchant.id}/follow").status_code == 204
    )  # idempotent
    assert client.get("/users/me/follows").json() == [rival.id]


def test_cannot_follow_missing_suspended_or_own_farm(db, merchant, buyer):  # noqa: F811
    client = _client(db, buyer[0])
    assert client.put("/merchants/999/follow").status_code == 404

    owner = db.get(User, merchant.user_id)
    assert _client(db, owner).put(f"/merchants/{merchant.id}/follow").status_code == 400

    set_identity(db, owner, banned=True)
    db.commit()
    assert client.put(f"/merchants/{merchant.id}/follow").status_code == 404


def test_follows_are_private_per_buyer(db, merchant, buyer):  # noqa: F811
    _client(db, buyer[0]).put(f"/merchants/{merchant.id}/follow")
    other = make_user(db, "other@example.com", notifications_preferences={})
    db.add(other)
    db.commit()
    assert _client(db, other).get("/users/me/follows").json() == []

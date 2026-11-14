"""Saved delivery addresses: one user, many addresses, one default."""

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import user_addresses, users
from app.api.routes.user_addresses import MAX_ADDRESSES
from app.models.user import User
from app.models.user_address import UserAddress
from tests.test_reviews import buyer, db  # noqa: F401 - fixtures


def _client(db, user):  # noqa: F811
    app = FastAPI()
    app.include_router(users.router)
    app.include_router(user_addresses.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _defaults(db, user):  # noqa: F811
    return [
        a.id for a in db.query(UserAddress).filter_by(user_id=user.id, is_default=True)
    ]


def test_first_address_is_default_and_others_are_not(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    home = me.post("/users/me/addresses", json={"label": "Home", "city": "Malolos"})
    work = me.post("/users/me/addresses", json={"label": "Work", "city": "Hagonoy"})
    assert home.status_code == work.status_code == 201
    assert home.json()["is_default"] is True
    assert work.json()["is_default"] is False

    listed = me.get("/users/me/addresses").json()
    assert [a["label"] for a in listed] == ["Home", "Work"]  # default first
    profile = me.get("/users/me").json()
    assert [a["label"] for a in profile["addresses"]] == ["Home", "Work"]


def test_switching_default_keeps_exactly_one(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    home = me.post("/users/me/addresses", json={"label": "Home"}).json()
    work = me.post(
        "/users/me/addresses", json={"label": "Work", "is_default": True}
    ).json()
    assert _defaults(db, buyer[0]) == [work["id"]]

    res = me.patch(f"/users/me/addresses/{home['id']}", json={"is_default": True})
    assert res.status_code == 200 and res.json()["is_default"] is True
    assert _defaults(db, buyer[0]) == [home["id"]]


def test_deleting_default_promotes_oldest_remaining(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    home = me.post("/users/me/addresses", json={"label": "Home"}).json()
    work = me.post("/users/me/addresses", json={"label": "Work"}).json()

    assert me.delete(f"/users/me/addresses/{home['id']}").status_code == 204
    assert _defaults(db, buyer[0]) == [work["id"]]
    db.expire_all()
    assert buyer[0].default_address.id == work["id"]


def test_cannot_touch_someone_elses_address(db, buyer):  # noqa: F811
    other = User(email="other@example.com")
    db.add(other)
    db.flush()
    theirs = UserAddress(user_id=other.id, city="Malolos", is_default=True)
    db.add(theirs)
    db.commit()

    me = _client(db, buyer[0])
    assert (
        me.patch(f"/users/me/addresses/{theirs.id}", json={"city": "X"}).status_code
        == 404
    )
    assert me.delete(f"/users/me/addresses/{theirs.id}").status_code == 404
    assert me.get("/users/me/addresses").json() == []


def test_address_limit_and_unknown_fields(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    assert me.post("/users/me/addresses", json={"user_id": 999}).status_code == 422
    for i in range(MAX_ADDRESSES):
        assert (
            me.post("/users/me/addresses", json={"label": f"A{i}"}).status_code == 201
        )
    assert me.post("/users/me/addresses", json={"label": "one more"}).status_code == 400


def test_profile_patch_no_longer_takes_address_fields(db, buyer):  # noqa: F811
    me = _client(db, buyer[0])
    assert me.patch("/users/me", json={"city": "Malolos"}).status_code == 422

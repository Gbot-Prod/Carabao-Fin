"""BetterAuth tokens: what the backend accepts, and the rows it creates or links."""

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_current_user, get_db
from app.api.routes import auth, users
from app.core import security
from app.models import (  # noqa: F401  (registers User's related mappers)
    cart,
    merchant,
    merchant_application,
    merchant_payout,
    order,
    payout_batch,
    produce,
    review,
    shipment,
    shopPage,
    transaction,
)
from app.models.user import User
from tests import better_auth
from tests.tokens import (
    ISSUER,
    KEY,
    REAL_SIGNING_KEY,
    bearer,
    make_token,
    trust_test_key,
)


@pytest.fixture(autouse=True)
def _trust(monkeypatch):
    trust_test_key(monkeypatch)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    User.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(auth.router)
    app.include_router(users.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _add_user(db, **fields):
    user = User(notifications_preferences={}, **fields)
    db.add(user)
    db.commit()
    return user


def _me(client, **token):
    return client.get("/auth/me", headers=bearer(**token))


# ── Token checks ─────────────────────────────────────────────────────────


def test_valid_token_is_accepted(client):
    assert _me(client).status_code == 200


def test_missing_token_is_401(client):
    assert client.get("/auth/me").status_code == 401


@pytest.mark.parametrize(
    "token_kwargs",
    [
        {"ttl": -120},  # expired beyond the leeway
        {"aud": "someone-else"},
        {"iss": "https://evil.example"},
        {"key": Ed25519PrivateKey.generate()},  # not BetterAuth's key
        {"sub": None},
    ],
)
def test_bad_tokens_are_rejected(client, db, token_kwargs):
    res = client.get("/auth/me", headers=bearer(make_token(**token_kwargs)))
    assert res.status_code == 401
    assert db.query(User).count() == 0


def test_hs256_token_signed_with_a_guessable_secret_is_rejected(client):
    now = int(time.time())
    forged = jwt.encode(
        {
            "sub": "ba_x",
            "email": "x@example.com",
            "iss": ISSUER,
            "aud": "carabao-api",
            "iat": now,
            "exp": now + 600,
        },
        "any-secret-at-all-0123456789abcdef",
        algorithm="HS256",
    )
    assert client.get("/auth/me", headers=bearer(forged)).status_code == 401


class _FakeJwks:
    def __init__(self, error=None, key=None):
        self.error, self.key = error, key

    def get_signing_key_from_jwt(self, _token):
        if self.error:
            raise self.error
        return type("K", (), {"key": self.key})()


def test_keys_come_from_the_jwks_client(client, monkeypatch):
    monkeypatch.setattr(security, "_signing_key", REAL_SIGNING_KEY)
    monkeypatch.setattr(
        security, "_jwk_client", lambda _url: _FakeJwks(key=KEY.public_key())
    )
    assert _me(client).status_code == 200


def test_jwks_outage_is_503_not_401(client, monkeypatch):
    monkeypatch.setattr(security, "_signing_key", REAL_SIGNING_KEY)
    monkeypatch.setattr(
        security,
        "_jwk_client",
        lambda _url: _FakeJwks(error=jwt.PyJWKClientConnectionError("down")),
    )
    assert _me(client).status_code == 503


def test_unknown_key_id_is_401(client, monkeypatch):
    monkeypatch.setattr(security, "_signing_key", REAL_SIGNING_KEY)
    monkeypatch.setattr(
        security,
        "_jwk_client",
        lambda _url: _FakeJwks(error=jwt.PyJWKClientError("no matching kid")),
    )
    assert _me(client).status_code == 401


def test_jwks_url_follows_better_auth_url(monkeypatch):
    monkeypatch.setenv("BETTER_AUTH_URL", '"https://shop.example.com/some/path/"')
    monkeypatch.delenv("BETTER_AUTH_JWKS_URL", raising=False)
    assert security.token_issuer() == "https://shop.example.com"
    assert security.jwks_url() == "https://shop.example.com/api/auth/jwks"


# ── Creating and linking rows ────────────────────────────────────────────


def test_first_request_creates_the_row_from_the_claims(client, db):
    res = _me(
        client,
        sub="ba_new",
        email="New@Example.com",
        name="Juan dela Cruz",
        phoneNumber="639123456789",
    )

    assert res.status_code == 200
    user = db.query(User).one()
    assert (user.external_auth_id, user.email) == ("ba_new", "new@example.com")
    assert user.name == "Juan dela Cruz"
    assert user.phone_number == "639123456789"
    assert user.is_admin is False


def test_unverified_email_gets_no_row(client, db):
    assert _me(client, emailVerified=False).status_code == 403
    assert db.query(User).count() == 0


def test_verified_email_links_an_unclaimed_row(client, db):
    row = _add_user(db, email="Victim@Example.com", name="Kept")

    assert _me(client, sub="ba_owner", email="victim@example.com").status_code == 200

    db.refresh(row)
    assert row.external_auth_id == "ba_owner"
    assert row.name == "Kept"
    assert db.query(User).count() == 1


def test_unverified_email_cannot_link_an_existing_row(client, db):
    _add_user(db, email="victim@example.com")

    res = _me(
        client, sub="ba_attacker", email="victim@example.com", emailVerified=False
    )

    assert res.status_code == 403
    assert db.query(User).one().external_auth_id is None


def test_new_identity_cannot_take_over_a_linked_row(client, db):
    _add_user(db, email="victim@example.com", external_auth_id="ba_owner")

    res = _me(client, sub="ba_attacker", email="victim@example.com")

    assert res.status_code == 409
    assert db.query(User).one().external_auth_id == "ba_owner"


def test_phone_already_used_is_left_off_the_new_row(client, db):
    _add_user(db, email="a@example.com", phone_number="639123456789")

    assert (
        _me(client, email="b@example.com", phoneNumber="639123456789").status_code
        == 200
    )

    assert db.query(User).filter_by(email="b@example.com").one().phone_number is None


def test_admin_role_is_taken_only_when_the_row_is_created(client, db):
    assert (
        _me(client, sub="ba_a", email="a@example.com", role="admin").status_code == 200
    )
    user = db.query(User).one()
    assert user.is_admin is True

    # Demoted in the backend; an older token still saying "admin" can't undo it.
    user.is_admin = False
    db.commit()
    _me(client, sub="ba_a", email="a@example.com", role="admin")
    db.refresh(user)
    assert user.is_admin is False


# ── Keeping the row in step ──────────────────────────────────────────────


def test_google_photo_becomes_the_avatar_on_first_login(client, db):
    _me(client, sub="ba_g", image="https://lh3.example/photo.jpg")
    assert db.query(User).one().profile_picture_url == "https://lh3.example/photo.jpg"


def test_google_photo_does_not_replace_an_existing_avatar(client, db):
    row = _add_user(db, email="me@example.com", profile_picture_url="mine.png")

    _me(client, sub="ba_me", email="me@example.com", image="https://lh3.example/p")

    db.refresh(row)
    assert row.profile_picture_url == "mine.png"


def test_verified_email_change_is_applied(client, db):
    user = _add_user(db, email="old@example.com", external_auth_id="ba_me")

    assert _me(client, sub="ba_me", email="new@example.com").status_code == 200

    db.refresh(user)
    assert user.email == "new@example.com"


def test_unverified_email_change_is_ignored(client, db):
    user = _add_user(db, email="old@example.com", external_auth_id="ba_me")

    _me(client, sub="ba_me", email="victim@example.com", emailVerified=False)

    db.refresh(user)
    assert user.email == "old@example.com"


def test_email_change_to_a_used_address_keeps_the_old_one(client, db):
    _add_user(db, email="taken@example.com", external_auth_id="ba_other")
    user = _add_user(db, email="old@example.com", external_auth_id="ba_me")

    assert _me(client, sub="ba_me", email="taken@example.com").status_code == 200

    db.refresh(user)
    assert user.email == "old@example.com"


def test_names_edited_in_the_backend_are_not_overwritten(client, db):
    user = _add_user(
        db, email="me@example.com", external_auth_id="ba_me", name="Edited"
    )

    _me(client, sub="ba_me", email="me@example.com", name="Original Name")

    db.refresh(user)
    assert user.name == "Edited"


def test_suspended_user_is_refused(client, db):
    from datetime import UTC, datetime

    _add_user(
        db,
        email="me@example.com",
        external_auth_id="ba_me",
        suspended_at=datetime.now(UTC),
    )
    assert _me(client, sub="ba_me", email="me@example.com").status_code == 403


def test_patch_me_rejects_identity_fields(client, db):
    user = _add_user(db, email="me@example.com", external_auth_id="ba_me")
    client.app.dependency_overrides[get_current_user] = lambda: user

    for field, value in (
        ("email", "victim@example.com"),
        ("external_auth_id", "ba_victim"),
    ):
        res = client.patch("/users/me", json={field: value})
        assert res.status_code == 422

    db.refresh(user)
    assert (user.email, user.external_auth_id) == ("me@example.com", "ba_me")


# ── BetterAuth rows (better_auth_store) ──────────────────────────────────


def _better_auth_tables(db, *user_ids):
    better_auth.create_tables(db)
    for uid in user_ids:
        better_auth.add_identity(db, uid)


def test_token_for_a_deleted_identity_creates_no_row(client, db):
    _better_auth_tables(db, "ba_someone_else")

    res = _me(client, sub="ba_deleted", email="gone@example.com")

    assert res.status_code == 401
    assert db.query(User).count() == 0


def test_existing_identity_is_created_as_usual(client, db):
    _better_auth_tables(db, "ba_new")
    assert _me(client, sub="ba_new", email="new@example.com").status_code == 200


def test_deleting_the_account_removes_the_login_too(client, db):
    from sqlalchemy import text

    from app.core.database import Base

    Base.metadata.create_all(db.get_bind())  # deletion checks orders etc. first
    _better_auth_tables(db, "ba_me", "ba_other")
    assert _me(client, sub="ba_me", email="me@example.com").status_code == 200

    res = client.delete(
        "/users/me", headers=bearer(sub="ba_me", email="me@example.com")
    )

    assert res.status_code == 204, res.text
    ids = db.execute(text('SELECT id FROM "user"')).scalars().all()
    assert ids == ["ba_other"]
    # The same (still unexpired) token can't bring the account back.
    assert _me(client, sub="ba_me", email="me@example.com").status_code == 401
    assert db.query(User).count() == 0


def test_role_and_ban_writes_and_missing_tables(db):
    from sqlalchemy import text

    from app.services import better_auth_store

    # No BetterAuth tables: nothing happens, nothing raises.
    better_auth_store.set_role(db, "ba_x", is_admin=True)
    better_auth_store.delete_identity(db, "ba_x")
    assert better_auth_store.identity_exists(db, "ba_x") is True

    _better_auth_tables(db, "ba_x")
    db.execute(text("""INSERT INTO "session" (id, "userId") VALUES ('s1', 'ba_x')"""))
    better_auth_store.set_role(db, "ba_x", is_admin=True)
    assert db.execute(text('SELECT role FROM "user"')).scalar() == "admin"
    better_auth_store.set_role(db, "ba_x", is_admin=False)
    assert db.execute(text('SELECT role FROM "user"')).scalar() == "user"


# ── Writing profile edits back to BetterAuth ─────────────────────────────


def _me_headers():
    return bearer(sub="ba_me", email="me@example.com")


@pytest.fixture
def full_schema(db):
    """The profile response loads the user's merchant and cart."""
    from app.core.database import Base

    Base.metadata.create_all(db.get_bind())


def test_profile_edit_is_written_back_to_better_auth(client, db, full_schema):
    _better_auth_tables(db, "ba_me")
    assert _me(client, sub="ba_me", email="me@example.com").status_code == 200

    res = client.patch(
        "/users/me",
        json={"name": "Maria Santos", "phone_number": "639170000000"},
        headers=_me_headers(),
    )

    assert res.status_code == 200, res.text
    assert res.json()["name"] == "Maria Santos"
    identity = better_auth.get_identity(db, "ba_me")
    assert (identity["name"], identity["phoneNumber"]) == ("Maria Santos", "639170000000")


def test_cleared_name_is_stored_empty_in_better_auth(client, db, full_schema):
    _better_auth_tables(db, "ba_me")
    _me(client, sub="ba_me", email="me@example.com", name="Old Name")

    client.patch("/users/me", json={"name": None}, headers=_me_headers())

    assert better_auth.get_identity(db, "ba_me")["name"] == ""


def test_avatar_upload_is_written_back_to_better_auth(
    client, db, full_schema, monkeypatch
):
    from app.services import r2_service

    monkeypatch.setattr(
        r2_service, "upload_avatar", lambda *a, **k: "https://cdn.example/a.png"
    )
    _better_auth_tables(db, "ba_me")
    _me(client, sub="ba_me", email="me@example.com")

    res = client.post(
        "/users/me/avatar",
        files={"avatar": ("a.png", b"png", "image/png")},
        headers=_me_headers(),
    )

    assert res.status_code == 200, res.text
    assert better_auth.get_identity(db, "ba_me")["image"] == "https://cdn.example/a.png"


def test_failed_write_back_rolls_the_profile_edit_back(client, db, full_schema):
    _better_auth_tables(db, "ba_me")
    _me(client, sub="ba_me", email="me@example.com", name="Old Name")
    better_auth.break_user_table(db)

    res = client.patch("/users/me", json={"name": "New Name"}, headers=_me_headers())

    assert res.status_code == 503
    db.rollback()  # get_db closes the request's session without committing
    assert db.query(User).one().name == "Old Name"


def test_failed_identity_delete_keeps_the_account(client, db):
    from app.core.database import Base

    Base.metadata.create_all(db.get_bind())
    _better_auth_tables(db, "ba_me")
    _me(client, sub="ba_me", email="me@example.com")
    better_auth.break_user_table(db)

    res = client.delete("/users/me", headers=_me_headers())

    assert res.status_code == 503
    db.rollback()  # get_db closes the request's session without committing
    assert db.query(User).count() == 1
    assert better_auth.get_identity(db, "ba_me") is not None


def test_profile_edit_without_better_auth_tables_still_saves(client, db, full_schema):
    _me(client, sub="ba_me", email="me@example.com")

    res = client.patch("/users/me", json={"name": "Solo"}, headers=_me_headers())

    assert res.status_code == 200
    assert db.query(User).one().name == "Solo"

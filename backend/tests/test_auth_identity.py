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

from app.api.dependencies import get_db
from app.api.routes import auth, users
from app.core import security
from app.core.database import Base
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
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    better_auth.create_tables(session)
    # The identity behind the default test token (tests/tokens.py make_token).
    better_auth.add_identity(session, "ba_user", email="user@example.com")
    yield session
    session.close()


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(auth.router)
    app.include_router(users.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


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


# ── Rows for BetterAuth identities ───────────────────────────────────────


def _row(db, identity_id):
    return db.query(User).filter_by(external_auth_id=identity_id).one()


def test_first_request_creates_the_row_and_reads_identity_live(client, db):
    better_auth.add_identity(
        db,
        "ba_new",
        email="new@example.com",
        name="Juan dela Cruz",
        phoneNumber="+639123456789",
        phoneNumberVerified=True,
    )
    # The token's claims don't matter: identity comes from BetterAuth's table.
    res = _me(client, sub="ba_new", email="stale@example.com", name="Stale")

    assert res.status_code == 200
    body = res.json()
    assert body["email"] == "new@example.com" and body["name"] == "Juan dela Cruz"
    assert body["phone_number"] == "+639123456789" and body["phone_verified"] is True
    assert body["is_admin"] is False
    assert db.query(User).filter_by(external_auth_id="ba_new").count() == 1


def test_phone_signup_has_no_email(client, db):
    better_auth.add_identity(
        db,
        "ba_phone",
        email="639123456789@phone.carabao.invalid",
        emailVerified=False,
        phoneNumber="+639123456789",
        phoneNumberVerified=True,
    )
    body = _me(client, sub="ba_phone").json()
    assert body["email"] is None and body["email_verified"] is False
    assert body["phone_verified"] is True


def test_unverified_email_is_not_required(client, db):
    better_auth.add_identity(db, "ba_g", email="g@example.com", emailVerified=False)
    res = _me(client, sub="ba_g", emailVerified=False)
    assert res.status_code == 200
    assert res.json()["email_verified"] is False


def test_token_for_a_deleted_identity_creates_no_row(client, db):
    res = _me(client, sub="ba_deleted", email="gone@example.com")
    assert res.status_code == 401
    assert db.query(User).count() == 0


def test_admin_role_is_read_live_from_better_auth(client, db):
    better_auth.add_identity(db, "ba_a", role="admin")
    assert _me(client, sub="ba_a").json()["is_admin"] is True

    # Demoted in BetterAuth: an older token still saying "admin" changes nothing.
    better_auth.set_identity(db, _row(db, "ba_a"), role="user")
    assert _me(client, sub="ba_a", role="admin").json()["is_admin"] is False


def test_banned_identity_is_refused(client, db):
    better_auth.add_identity(db, "ba_me", banned=True, banReason="Spam")
    res = _me(client, sub="ba_me")
    assert res.status_code == 403
    assert "Spam" in res.json()["detail"]


def test_google_photo_becomes_the_avatar_on_first_login_only(client, db):
    better_auth.add_identity(db, "ba_g", image="https://lh3.example/photo.jpg")
    _me(client, sub="ba_g")
    row = _row(db, "ba_g")
    assert row.profile_picture_url == "https://lh3.example/photo.jpg"

    row.profile_picture_url = "mine.png"
    db.commit()
    _me(client, sub="ba_g")
    db.refresh(row)
    assert row.profile_picture_url == "mine.png"


def test_patch_me_rejects_identity_fields(client, db):
    _me(client)
    for field, value in (
        ("email", "victim@example.com"),
        ("name", "Someone Else"),
        ("phone_number", "+639170000000"),
        ("external_auth_id", "ba_victim"),
    ):
        res = client.patch("/users/me", json={field: value}, headers=bearer())
        assert res.status_code == 422, field

    identity = better_auth.get_identity(db, "ba_user")
    assert identity["email"] == "user@example.com" and identity["phoneNumber"] is None


def test_orm_cannot_write_identity(db):
    from app.models.auth_identity import AuthIdentity

    db.get(AuthIdentity, "ba_user").name = "Changed"
    with pytest.raises(RuntimeError, match="read-only"):
        db.flush()
    db.rollback()


# ── Verified phone gate ──────────────────────────────────────────────────


def test_verified_phone_is_required_where_asked(db):
    from fastapi import Depends

    from app.api.dependencies import PHONE_VERIFICATION_REQUIRED, require_verified_phone

    app = FastAPI()

    @app.post("/buy")
    def buy(user: User = Depends(require_verified_phone)):
        return {"ok": True}

    app.dependency_overrides[get_db] = lambda: db
    gate = TestClient(app)

    # A Google sign-in: no phone yet.
    res = gate.post("/buy", headers=bearer())
    assert res.status_code == 403
    assert res.json()["detail"] == PHONE_VERIFICATION_REQUIRED

    # A number that isn't verified doesn't count either.
    better_auth.set_identity(db, _row(db, "ba_user"), phoneNumber="+639170000000")
    assert gate.post("/buy", headers=bearer()).status_code == 403

    better_auth.set_identity(db, _row(db, "ba_user"), phoneNumberVerified=True)
    assert gate.post("/buy", headers=bearer()).status_code == 200


# ── Writes to BetterAuth (better_auth_store) ─────────────────────────────


def test_deleting_the_account_removes_the_login_too(client, db):
    from sqlalchemy import text

    better_auth.add_identity(db, "ba_me")
    assert _me(client, sub="ba_me").status_code == 200

    res = client.delete("/users/me", headers=bearer(sub="ba_me"))

    assert res.status_code == 204, res.text
    ids = db.execute(text('SELECT id FROM "user"')).scalars().all()
    assert "ba_me" not in ids and "ba_user" in ids
    # The same (still unexpired) token can't bring the account back.
    assert _me(client, sub="ba_me").status_code == 401
    assert db.query(User).filter_by(external_auth_id="ba_me").count() == 0


def test_role_writes(db):
    from app.services import better_auth_store

    better_auth_store.set_role(db, "ba_user", is_admin=True)
    assert better_auth.get_identity(db, "ba_user")["role"] == "admin"
    better_auth_store.set_role(db, "ba_user", is_admin=False)
    assert better_auth.get_identity(db, "ba_user")["role"] == "user"


def test_writes_refresh_an_identity_already_loaded(client, db):
    from app.services import better_auth_store

    _me(client)
    user = _row(db, "ba_user")
    assert user.is_admin is False
    better_auth_store.set_role(db, "ba_user", is_admin=True)
    assert user.is_admin is True


def test_avatar_upload_is_written_back_to_better_auth(client, db, monkeypatch):
    from app.services import r2_service

    monkeypatch.setattr(
        r2_service, "upload_avatar", lambda *a, **k: "https://cdn.example/a.png"
    )
    res = client.post(
        "/users/me/avatar",
        files={"avatar": ("a.png", b"png", "image/png")},
        headers=bearer(),
    )

    assert res.status_code == 200, res.text
    assert (
        better_auth.get_identity(db, "ba_user")["image"] == "https://cdn.example/a.png"
    )


def test_failed_identity_delete_keeps_the_account(client, db):
    _me(client)
    better_auth.break_user_table(db)

    res = client.delete("/users/me", headers=bearer())

    assert res.status_code == 503
    db.rollback()  # get_db closes the request's session without committing
    assert db.query(User).count() == 1
    assert better_auth.get_identity(db, "ba_user") is not None


def test_placeholder_email_is_null_in_queries_too(db):
    phone = better_auth.make_user(db, identity_id="ba_ph", phone_number="+639171112222")
    real = better_auth.make_user(db, identity_id="ba_real", email="ana@example.com")
    db.commit()
    assert db.query(User).filter(User.email.ilike("%639%")).count() == 0
    assert db.query(User).filter(User.email.ilike("%invalid%")).count() == 0
    assert db.query(User).filter(User.email.is_(None)).one().id == phone.id
    assert db.query(User).filter(User.email == "ana@example.com").one().id == real.id

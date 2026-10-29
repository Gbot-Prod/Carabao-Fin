import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_current_user, get_db
from app.api.routes import auth, users
from app.core.security import create_access_token
from app.models import (  # noqa: F401  (registers User's related mappers)
    cart,
    current_orders,
    merchant,
    merchant_application,
    merchant_payout,
    mobile_credential,
    order,
    order_history,
    payout_batch,
    produce,
    shipment,
    shopPage,
    transaction,
)
from app.models.user import User
from app.services.phone_verification import sign_token

SECRET = "test-secret"
HEADERS = {"X-Internal-Auth-Sync-Secret": SECRET}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", SECRET)


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


def _sync(client, **overrides):
    body = {"provider_user_id": "ba_attacker", "email": "victim@example.com"}
    body.update(overrides)
    return client.post("/auth/sync", json=body, headers=HEADERS)


def _email_token(email):
    return sign_token({"channel": "email", "identifier": email}, 600)


def _phone_token(number="639123456789"):
    return sign_token({"channel": "phone", "identifier": number}, 600)


def _add_user(db, **fields):
    user = User(notifications_preferences={}, **fields)
    db.add(user)
    db.commit()
    return user


def test_unverified_email_cannot_link_existing_row(client, db):
    _add_user(db, email="victim@example.com")

    res = _sync(client, verification_token=_phone_token())

    assert res.status_code == 403
    assert db.query(User).one().external_auth_id is None


def test_verified_email_cannot_take_over_linked_row(client, db):
    _add_user(db, email="victim@example.com", external_auth_id="ba_owner")

    res = _sync(client, email_verified=True)

    assert res.status_code == 409
    assert db.query(User).one().external_auth_id == "ba_owner"


def test_verified_email_links_unclaimed_row(client, db):
    row = _add_user(db, email="Victim@Example.com")

    res = _sync(client, provider_user_id="ba_owner", email_verified=True)

    assert res.status_code == 200
    db.refresh(row)
    assert row.external_auth_id == "ba_owner"


def test_new_user_needs_some_verification(client):
    assert _sync(client).status_code == 403
    assert _sync(client, email_verified=True).status_code == 200


def test_email_token_must_match_signup_email(client):
    res = _sync(client, verification_token=_email_token("other@example.com"))
    assert res.status_code == 403


def test_email_token_creates_lowercased_row(client, db):
    res = _sync(
        client,
        email="New@Example.com",
        verification_token=_email_token("new@example.com"),
    )

    assert res.status_code == 200
    assert db.query(User).one().email == "new@example.com"


def test_unverified_email_change_is_not_synced(client, db):
    _add_user(db, email="old@example.com", external_auth_id="ba_attacker")

    res = _sync(client, email="victim@example.com")

    assert res.status_code == 200
    assert db.query(User).one().email == "old@example.com"


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


def test_unknown_token_subject_is_not_relinked_by_email(client, db, monkeypatch):
    monkeypatch.setenv("FASTAPI_JWT_SECRET", "jwt-secret")
    _add_user(db, email="victim@example.com", external_auth_id="ba_owner")
    token = create_access_token(
        subject="ba_attacker",
        expires_minutes=5,
        extra_claims={"email": "victim@example.com"},
    )

    res = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 401
    assert db.query(User).one().external_auth_id == "ba_owner"

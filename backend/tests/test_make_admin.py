"""scripts/make_admin.py: promote or create an admin, logged as "system"."""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import text

from app.models.admin_audit_log import AdminAuditLog
from app.models.auth_identity import AuthIdentity
from app.services import admin_enrolment, audit_log, better_auth_store
from tests.better_auth import create_tables, get_identity, make_user
from tests.test_reviews import db  # noqa: F401 - fixture

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "make_admin.py"
_spec = importlib.util.spec_from_file_location("make_admin_script", _SCRIPT)
assert _spec and _spec.loader
make_admin_script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(make_admin_script)

# Made by this code and accepted by Better Auth's verifyPassword (Node), so the
# admin can sign in with it on the web.
_VECTOR_PASSWORD = "Pässwörd-ﬁ 123"
_VECTOR_SALT = "00112233445566778899aabbccddeeff"
_VECTOR_HASH = (
    "00112233445566778899aabbccddeeff:34bf6543f948877fece898eae5ca74c575bb72f718bb"
    "4c6412b4f05dcce97a69c683cc4d7a62c8483a049ed79b5c17cce601979b7d3cb056d8b6c5057"
    "2c9ab45"
)


def test_password_hash_matches_better_auth():
    assert (
        better_auth_store.hash_password(_VECTOR_PASSWORD, salt=_VECTOR_SALT)
        == _VECTOR_HASH
    )
    salt, key = better_auth_store.hash_password("another one").split(":")
    assert len(salt) == 32 and len(key) == 128


def test_ids_look_like_better_auth_ids():
    ids = {better_auth_store.new_id() for _ in range(50)}
    assert len(ids) == 50
    assert all(len(i) == 32 and i.isalnum() for i in ids)


@pytest.fixture
def links(monkeypatch):
    monkeypatch.setenv("ADMIN_URL", "https://admin.web.test")


def test_create_makes_a_verified_email_login(db, links):  # noqa: F811
    create_tables(db)
    identity_id = better_auth_store.create_email_identity(
        db, email="boss@example.com", name="Boss", password="a long admin password"
    )
    identity = db.get(AuthIdentity, identity_id)
    token = make_admin_script.make_admin(db, identity, created=True)

    row = get_identity(db, identity_id)
    assert row["email"] == "boss@example.com" and row["emailVerified"]
    assert row["role"] == "admin"
    account = (
        db.execute(
            text('SELECT * FROM "account" WHERE "userId" = :u'), {"u": identity_id}
        )
        .mappings()
        .one()
    )
    assert account["providerId"] == "credential"
    salt = account["password"].split(":")[0]
    assert account["password"] == better_auth_store.hash_password(
        "a long admin password", salt=salt
    )
    assert admin_enrolment.setup_url(token).startswith(
        "https://admin.web.test/two-factor/enrol?token="
    )

    entry = db.query(AdminAuditLog).one()
    assert entry.admin_id is None and entry.admin_email == audit_log.SYSTEM_ACTOR
    assert entry.action == audit_log.ROLE_CHANGE
    assert entry.after == {
        "is_admin": True,
        "created": True,
        "via": "scripts/make_admin.py",
    }


def test_promote_is_logged_as_system(db, links):  # noqa: F811
    user = make_user(db, "seller@example.com", identity_id="ba_seller")
    db.commit()
    make_admin_script.make_admin(db, db.get(AuthIdentity, "ba_seller"), created=False)

    assert get_identity(db, "ba_seller")["role"] == "admin"
    entry = db.query(AdminAuditLog).one()
    assert entry.admin_email == "system" and entry.target_id == user.id
    assert entry.before == {"is_admin": False}

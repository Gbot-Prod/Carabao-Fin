"""scripts/make_admin.py: create or recover an admin, logged as "system"."""

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import text

from app.models.admin_audit_log import AdminAuditLog
from app.models.auth_identity import AuthIdentity
from app.models.user import User
from app.services import admin_enrolment, audit_log, better_auth_store
from tests.better_auth import add_password, create_tables, get_identity, make_user

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


def _account(db, identity_id):
    return (
        db.execute(
            text('SELECT * FROM "account" WHERE "userId" = :u'), {"u": identity_id}
        )
        .mappings()
        .all()
    )


def test_create_makes_a_verified_email_admin(db, links):  # noqa: F811
    create_tables(db)
    token = make_admin_script.create_admin(
        db, email="Boss@Example.com", name="Boss", password="A long admin pass 1!"
    )

    identity = db.query(AuthIdentity).filter_by(email="boss@example.com").one()
    row = get_identity(db, identity.id)
    assert row["emailVerified"] and row["role"] == "admin"
    assert not row["twoFactorEnabled"] and not row["banned"]
    [account] = _account(db, identity.id)
    assert account["providerId"] == "credential"
    salt = account["password"].split(":")[0]
    assert account["password"] == better_auth_store.hash_password(
        "A long admin pass 1!", salt=salt
    )
    assert admin_enrolment.setup_url(token).startswith(
        "https://admin.web.test/two-factor/enrol?token="
    )
    assert db.query(User).filter_by(external_auth_id=identity.id).count() == 1

    entry = db.query(AdminAuditLog).one()
    assert entry.admin_id is None and entry.admin_email == audit_log.SYSTEM_ACTOR
    assert entry.action == audit_log.ADMIN_CREATE
    assert entry.after == {"email": "boss@example.com", "via": "scripts/make_admin.py"}


def test_create_refuses_an_email_that_has_any_account(db, links):  # noqa: F811
    make_user(db, "seller@example.com", identity_id="ba_seller")
    db.commit()
    with pytest.raises(SystemExit):
        make_admin_script.create_admin(
            db, email="seller@example.com", name="", password="A long admin pass 1!"
        )
    assert get_identity(db, "ba_seller")["role"] == "user"
    assert db.query(AdminAuditLog).count() == 0


def test_there_is_no_promote_mode():
    assert not hasattr(make_admin_script, "make_admin")
    with pytest.raises(SystemExit):
        make_admin_script.sys.argv = ["make_admin.py", "seller@example.com"]
        make_admin_script.main()


def test_recover_clears_two_factor_ban_and_sessions(db, links):  # noqa: F811
    admin = make_user(
        db, "admin@example.com", identity_id="ba_admin", is_admin=True, banned=True
    )
    db.commit()
    add_password(db, admin, "A long admin pass 1!")
    db.execute(
        text("""INSERT INTO "session" (id, "userId") VALUES ('s1', 'ba_admin')""")
    )
    db.commit()

    token = make_admin_script.recover_admin(
        db, db.get(AuthIdentity, "ba_admin"), password=None
    )

    row = get_identity(db, "ba_admin")
    assert not row["banned"] and not row["twoFactorEnabled"] and row["role"] == "admin"
    assert db.execute(text('SELECT COUNT(*) FROM "session"')).scalar() == 0
    assert len(_account(db, "ba_admin")) == 1  # the password is kept
    stored = db.execute(
        text('SELECT value FROM "verification" WHERE identifier = :i'),
        {"i": better_auth_store.enrolment_identifier("ba_admin")},
    ).scalar()
    assert stored == admin_enrolment.hash_token(token)
    entry = db.query(AdminAuditLog).one()
    assert entry.action == audit_log.ADMIN_RECOVER
    assert entry.admin_email == "system" and entry.target_id == admin.id
    assert entry.before == {"is_deactivated": True, "two_factor_enabled": True}


def test_recover_sets_a_password_for_an_invite_never_accepted(db, links):  # noqa: F811
    make_user(
        db, "new@example.com", identity_id="ba_new", is_admin=True, two_factor=False
    )
    db.commit()
    identity = db.get(AuthIdentity, "ba_new")
    with pytest.raises(ValueError):
        make_admin_script.recover_admin(db, identity, password=None)

    make_admin_script.recover_admin(db, identity, password="A long admin pass 1!")
    [account] = _account(db, "ba_new")
    assert better_auth_store.password_matches(
        account["password"], "A long admin pass 1!"
    )


def test_recover_refuses_a_non_admin(db, links):  # noqa: F811
    make_user(db, "seller@example.com", identity_id="ba_seller")
    db.commit()
    with pytest.raises(SystemExit):
        make_admin_script.recover_admin(
            db, db.get(AuthIdentity, "ba_seller"), password=None
        )
    assert get_identity(db, "ba_seller")["role"] == "user"

"""Admin accounts: invite, accept, resend, deactivate, reactivate
(documentation/manuals/DB_ROLE_SPLIT_PLAN.md sections 2 and 7)."""

from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin, admin_accounts, users
from app.models.admin_audit_log import AdminAuditLog
from app.models.user import User
from app.services import admin_accounts as service
from app.services import admin_enrolment, better_auth_store
from tests.better_auth import (
    add_password,
    get_identity,
    make_user,
    set_identity,
)

PASSWORD = "A long admin pass 1!"


@pytest.fixture
def mail(monkeypatch):
    """Invite emails and setup links are captured, not sent."""
    out: dict[str, list] = {"invites": [], "setup": []}
    monkeypatch.setenv("RESEND_KEY", "test")  # no dev fallback to the log
    monkeypatch.setenv("ADMIN_URL", "https://admin.web.test")
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "s3cret")
    monkeypatch.setattr(
        service,
        "send_admin_invite_email",
        lambda to, *, invite_url, invited_by: out["invites"].append((to, invite_url)),
    )
    monkeypatch.setattr(
        admin_enrolment,
        "send_sms",
        lambda *, number, message: out["setup"].append(("sms", message)),
    )
    monkeypatch.setattr(
        admin_enrolment,
        "send_admin_enrolment_email",
        lambda to, url: out["setup"].append(("email", url)),
    )
    return out


def _client(db, actor) -> TestClient:
    app = FastAPI()
    for r in (admin.router, admin_accounts.router, users.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: actor
    return TestClient(app)


def _boss(db, email="boss@example.com") -> User:
    boss = make_user(db, email, is_admin=True)
    db.commit()
    add_password(db, boss, PASSWORD)
    return boss


def _invite(client, email="new@example.com", name="Ana Cruz"):
    return client.post("/admin/invites", json={"email": email, "name": name})


def _link(mail) -> tuple[str, str]:
    url = mail["invites"][-1][1]
    assert url.startswith("https://admin.web.test/admin/invite?")
    query = parse_qs(urlparse(url).query)
    return query["invite"][0], query["token"][0]


def _accept(client, invite, token, code, password=PASSWORD):
    return client.post(
        "/admin/invites/accept",
        json={"invite": invite, "token": token, "code": code, "password": password},
    )


def _verification(db, identifier):
    return better_auth_store.verification_row(db, identifier)


def _actions(db, target_id=None):
    q = db.query(AdminAuditLog)
    if target_id is not None:
        q = q.filter(AdminAuditLog.target_id == target_id)
    return [e.action for e in q.order_by(AdminAuditLog.id)]


# ── Invite ───────────────────────────────────────────────────────────────────


def test_invite_makes_an_admin_with_no_password_a_token_and_a_code(db, mail):
    boss = _boss(db)
    res = _invite(_client(db, boss), email="New@Example.com")

    assert res.status_code == 201, res.text
    body = res.json()
    assert body["user"]["is_admin"] and body["user"]["admin_invite_pending"]
    code = body["code"]
    assert len(code) == 9 and code[4] == "-"
    assert set(code.replace("-", "")) <= set(service.CODE_ALPHABET)

    invite_id, token = _link(mail)
    assert mail["invites"][-1][0] == "new@example.com"
    # The code is not in the email.
    assert code.replace("-", "") not in mail["invites"][-1][1]

    row = get_identity(db, invite_id)
    assert row["role"] == "admin" and row["name"] == "Ana Cruz"
    assert not row["emailVerified"] and not row["twoFactorEnabled"]
    assert not better_auth_store.has_credential_account(db, invite_id)

    # Only hashes are kept.
    stored_token = _verification(db, better_auth_store.enrolment_identifier(invite_id))
    assert stored_token[0] == admin_enrolment.hash_token(token)
    stored_code = _verification(db, better_auth_store.invite_code_identifier(invite_id))
    assert stored_code[0] == f"{service.hash_code(code.replace('-', ''))}:0"
    for stored in (stored_token, stored_code):
        expires_in = stored[1] - datetime.now(UTC)
        assert timedelta(hours=23) < expires_in <= timedelta(hours=24)

    assert _actions(db, body["user"]["id"]) == ["admin.invite"]


def test_invite_refused_for_an_email_that_has_any_account(db, mail):
    boss = _boss(db)
    make_user(db, "buyer@example.com")
    db.commit()

    res = _invite(_client(db, boss), email="BUYER@example.com")

    assert res.status_code == 409
    assert res.json()["detail"] == service.EMAIL_TAKEN_DETAIL
    assert mail["invites"] == []
    assert _actions(db) == []


@pytest.mark.parametrize("email", ["nope", "a@b", "x@phone.carabao.invalid"])
def test_invite_refuses_a_bad_email(db, mail, email):
    res = _invite(_client(db, _boss(db)), email=email)
    assert res.status_code == 422


def test_invite_needs_an_admin(db, mail):
    buyer = make_user(db, "b@example.com")
    db.commit()
    assert _invite(_client(db, buyer)).status_code == 403


def test_invite_email_failure_is_reported(db, mail, monkeypatch):
    def fail(*_a, **_k):
        raise RuntimeError("Resend down")

    monkeypatch.setattr(service, "send_admin_invite_email", fail)
    res = _invite(_client(db, _boss(db)))
    assert res.status_code == 502
    assert res.json()["detail"] == service.INVITE_NOT_SENT_DETAIL


# ── Accept ───────────────────────────────────────────────────────────────────


@pytest.fixture
def invited(db, mail):
    """(client, invite id, token, code) for a fresh invite."""
    client = _client(db, _boss(db))
    code = _invite(client).json()["code"]
    invite_id, token = _link(mail)
    return client, invite_id, token, code


def test_accept_writes_the_password_and_verifies_the_email(db, invited):
    client, invite_id, token, code = invited

    # Lower case and no dash is fine.
    res = _accept(client, invite_id, token, code.replace("-", "").lower())

    assert res.status_code == 200, res.text
    assert res.json() == {"email": "new@example.com"}
    assert get_identity(db, invite_id)["emailVerified"]
    stored = better_auth_store.stored_password(db, invite_id)
    assert better_auth_store.password_matches(stored, PASSWORD)
    # The code is used up; the setup token stays for TOTP setup.
    assert (
        _verification(db, better_auth_store.invite_code_identifier(invite_id)) is None
    )
    assert _verification(db, better_auth_store.enrolment_identifier(invite_id))
    user = db.query(User).filter_by(external_auth_id=invite_id).one()
    assert _actions(db, user.id) == ["admin.invite", "admin.invite_accepted"]

    # A second accept (the same link) is refused.
    assert _accept(client, invite_id, token, code).status_code == 400


def test_every_failure_gives_the_same_message(db, invited):
    client, invite_id, token, code = invited
    attempts = [
        _accept(client, invite_id, token, "ZZZZ-ZZZZ"),  # wrong code
        _accept(client, invite_id, "wrong-token", code),  # code without the token
        _accept(client, "no-such-invite", token, code),
    ]
    for res in attempts:
        assert res.status_code == 400
        assert res.json()["detail"] == service.INVITE_INVALID_DETAIL
    assert not better_auth_store.has_credential_account(db, invite_id)


def test_weak_password_is_refused_before_anything_is_checked(db, invited):
    client, invite_id, token, code = invited
    res = _accept(client, invite_id, token, code, password="short1!A")
    assert res.status_code == 422
    assert res.json()["detail"] == service.PASSWORD_RULE_DETAIL
    # Not counted against the code.
    stored = _verification(db, better_auth_store.invite_code_identifier(invite_id))
    assert stored[0].endswith(":0")


@pytest.mark.parametrize("which", ["token", "code"])
def test_expired_token_or_code_fails(db, invited, which):
    client, invite_id, token, code = invited
    identifier = (
        better_auth_store.enrolment_identifier(invite_id)
        if which == "token"
        else better_auth_store.invite_code_identifier(invite_id)
    )
    db.execute(
        text('UPDATE "verification" SET "expiresAt" = :past WHERE identifier = :i'),
        {"past": datetime.now(UTC) - timedelta(minutes=1), "i": identifier},
    )
    db.commit()

    res = _accept(client, invite_id, token, code)

    assert res.status_code == 400
    assert res.json()["detail"] == service.INVITE_INVALID_DETAIL


def test_a_wrong_token_does_not_count_against_the_code(db, invited):
    client, invite_id, token, code = invited
    for _ in range(service.MAX_CODE_ATTEMPTS):
        _accept(client, invite_id, "wrong-token", "ZZZZ-ZZZZ")
    assert _accept(client, invite_id, token, code).status_code == 200


def test_fifth_wrong_code_ends_the_invite(db, invited):
    client, invite_id, token, code = invited
    for n in range(1, service.MAX_CODE_ATTEMPTS):
        assert _accept(client, invite_id, token, "ZZZZ-ZZZZ").status_code == 400
        stored = _verification(db, better_auth_store.invite_code_identifier(invite_id))
        assert stored[0].endswith(f":{n}")

    assert _accept(client, invite_id, token, "ZZZZ-ZZZZ").status_code == 400

    assert (
        _verification(db, better_auth_store.invite_code_identifier(invite_id)) is None
    )
    assert _verification(db, better_auth_store.enrolment_identifier(invite_id)) is None
    # The right code no longer works.
    res = _accept(client, invite_id, token, code)
    assert res.status_code == 400
    assert not better_auth_store.has_credential_account(db, invite_id)
    assert "admin.invite_locked" in _actions(db)


def test_a_reset_link_cannot_set_a_password(db, mail):
    # An admin who already has a password gets a 2FA reset link. Its token,
    # even with a planted code, cannot replace the password.
    boss = _boss(db)
    other = make_user(db, "other@example.com", is_admin=True)
    db.commit()
    add_password(db, other, PASSWORD)
    client = _client(db, boss)
    assert client.post(f"/admin/users/{other.id}/two-factor/reset").status_code == 200
    token = mail["setup"][-1][1].split("token=")[1]
    better_auth_store.set_invite_code(
        db,
        other.external_auth_id,
        code_hash=service.hash_code("ABCDEFGH"),
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db.commit()

    res = _accept(client, other.external_auth_id, token, "ABCD-EFGH", "New pass 12345!")

    assert res.status_code == 400
    stored = better_auth_store.stored_password(db, other.external_auth_id)
    assert better_auth_store.password_matches(stored, PASSWORD)


def test_accept_is_rate_limited(db, invited):
    client, invite_id, token, _code = invited
    statuses = [
        _accept(client, invite_id, "wrong", "ZZZZ-ZZZZ").status_code for _ in range(11)
    ]
    assert statuses[-1] == 429


# ── Resend ───────────────────────────────────────────────────────────────────


def test_resend_replaces_token_and_code(db, invited, mail):
    client, invite_id, old_token, old_code = invited
    user = db.query(User).filter_by(external_auth_id=invite_id).one()

    res = client.post(f"/admin/invites/{user.id}/resend")

    assert res.status_code == 200, res.text
    new_code = res.json()["code"]
    _, new_token = _link(mail)
    assert new_token != old_token
    assert _accept(client, invite_id, old_token, new_code).status_code == 400
    assert _accept(client, invite_id, new_token, old_code).status_code == 400
    assert _accept(client, invite_id, new_token, new_code).status_code == 200
    assert "admin.invite_resent" in _actions(db, user.id)


def test_resend_refused_once_accepted(db, invited):
    client, invite_id, token, code = invited
    _accept(client, invite_id, token, code)
    user = db.query(User).filter_by(external_auth_id=invite_id).one()
    res = client.post(f"/admin/invites/{user.id}/resend")
    assert res.status_code == 409
    assert res.json()["detail"] == service.ALREADY_ACCEPTED_DETAIL


def test_resend_refused_for_a_non_admin(db, mail):
    boss = _boss(db)
    buyer = make_user(db, "b@example.com")
    db.commit()
    assert (
        _client(db, boss).post(f"/admin/invites/{buyer.id}/resend").status_code == 400
    )


# ── Deactivate, reactivate ───────────────────────────────────────────────────


def _with_sessions_and_two_factor(db, user):
    params = {"u": user.external_auth_id}
    db.execute(
        text(
            'INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId") '
            "VALUES (:u, 's', 'c', :u)"
        ),
        params,
    )
    db.execute(text('INSERT INTO "session" (id, "userId") VALUES (:u, :u)'), params)
    db.commit()


def _count(db, table, user):
    return db.execute(
        text(f'SELECT COUNT(*) FROM "{table}" WHERE "userId" = :u'),
        {"u": user.external_auth_id},
    ).scalar()


def test_deactivate_bans_keeps_the_role_and_clears_two_factor(db, mail):
    boss = _boss(db)
    other = make_user(db, "other@example.com", is_admin=True)
    db.commit()
    add_password(db, other, PASSWORD)
    _with_sessions_and_two_factor(db, other)

    res = _client(db, boss).post(f"/admin/admins/{other.id}/deactivate")

    assert res.status_code == 200, res.text
    row = get_identity(db, other.external_auth_id)
    assert row["role"] == "admin" and row["banned"]
    assert row["banReason"] == service.DEACTIVATED_REASON
    assert not row["twoFactorEnabled"]
    assert _count(db, "twoFactor", other) == 0 and _count(db, "session", other) == 0
    assert _actions(db, other.id) == ["admin.deactivate"]


def test_deactivating_a_pending_invite_clears_its_code(db, invited):
    client, invite_id, _token, _code = invited
    user = db.query(User).filter_by(external_auth_id=invite_id).one()
    assert client.post(f"/admin/admins/{user.id}/deactivate").status_code == 200
    assert (
        _verification(db, better_auth_store.invite_code_identifier(invite_id)) is None
    )
    assert _verification(db, better_auth_store.enrolment_identifier(invite_id)) is None


def test_deactivate_refused_for_yourself(db, mail):
    boss = _boss(db)
    res = _client(db, boss).post(f"/admin/admins/{boss.id}/deactivate")
    assert res.status_code == 400
    assert res.json()["detail"] == service.SELF_DEACTIVATE_DETAIL


def test_deactivate_refused_for_the_last_active_admin(db, mail):
    # Two admins deactivate each other at the same moment: the first one went
    # through (the actor here is already banned), so this one must not.
    boss = _boss(db)
    other = make_user(db, "other@example.com", is_admin=True)
    # A pending invitee cannot sign in, so it does not count as active.
    make_user(db, "pending@example.com", is_admin=True, two_factor=False)
    db.commit()
    client = _client(db, boss)
    set_identity(db, boss, banned=True)

    res = client.post(f"/admin/admins/{other.id}/deactivate")

    assert res.status_code == 409
    assert res.json()["detail"] == service.LAST_ADMIN_DETAIL
    assert not get_identity(db, other.external_auth_id)["banned"]


def test_reactivate_with_a_password_sends_a_setup_link(db, mail):
    boss = _boss(db)
    other = make_user(db, "other@example.com", is_admin=True)
    db.commit()
    add_password(db, other, PASSWORD)
    client = _client(db, boss)
    client.post(f"/admin/admins/{other.id}/deactivate")

    res = client.post(f"/admin/admins/{other.id}/reactivate")

    assert res.status_code == 200, res.text
    assert res.json()["sent_to"] == ["sms", "email"]
    assert res.json()["invite_code"] is None
    row = get_identity(db, other.external_auth_id)
    assert not row["banned"] and row["banReason"] is None
    assert _verification(
        db, better_auth_store.enrolment_identifier(other.external_auth_id)
    )
    assert _actions(db, other.id) == ["admin.deactivate", "admin.reactivate"]


def test_reactivate_without_a_password_makes_a_fresh_invite(db, invited, mail):
    client, invite_id, old_token, _ = invited
    user = db.query(User).filter_by(external_auth_id=invite_id).one()
    client.post(f"/admin/admins/{user.id}/deactivate")

    res = client.post(f"/admin/admins/{user.id}/reactivate")

    assert res.status_code == 200, res.text
    code = res.json()["invite_code"]
    _, token = _link(mail)
    assert token != old_token
    assert _accept(client, invite_id, token, code).status_code == 200


def test_reactivate_refused_when_not_deactivated(db, mail):
    boss = _boss(db)
    other = make_user(db, "other@example.com", is_admin=True)
    db.commit()
    res = _client(db, boss).post(f"/admin/admins/{other.id}/reactivate")
    assert res.status_code == 409


# ── No promotion, no ban or delete of admins ─────────────────────────────────


def test_role_endpoint_is_gone(db, mail):
    boss = _boss(db)
    buyer = make_user(db, "b@example.com")
    db.commit()
    res = _client(db, boss).patch(
        f"/admin/users/{buyer.id}/role", json={"is_admin": True}
    )
    assert res.status_code in (404, 405)
    assert get_identity(db, buyer.external_auth_id)["role"] == "user"


def test_suspend_and_reinstate_refuse_admins(db, mail):
    boss = _boss(db)
    other = make_user(db, "other@example.com", is_admin=True)
    db.commit()
    client = _client(db, boss)
    res = client.post(f"/admin/users/{other.id}/suspend", json={"reason": "x"})
    assert res.status_code == 400
    assert res.json()["detail"] == admin.ADMIN_SUSPEND_DETAIL
    assert client.post(f"/admin/users/{other.id}/reinstate").status_code == 400
    assert not get_identity(db, other.external_auth_id)["banned"]


def test_admin_account_cannot_be_deleted(db, mail):
    boss = _boss(db)
    client = _client(db, boss)
    res = client.post("/users/me/delete-code", json={"password": PASSWORD})
    assert res.status_code == 403
    assert res.json()["detail"] == users.ADMIN_DELETE_DETAIL
    res = client.request("DELETE", "/users/me", json={"code": "123456"})
    assert res.status_code == 403
    assert get_identity(db, boss.external_auth_id) is not None


def test_users_list_marks_pending_invites(db, invited):
    client, invite_id, token, code = invited
    rows = {
        u["external_auth_id"]: u for u in client.get("/admin/users").json()["items"]
    }
    assert rows[invite_id]["admin_invite_pending"] is True
    _accept(client, invite_id, token, code)
    rows = {
        u["external_auth_id"]: u for u in client.get("/admin/users").json()["items"]
    }
    assert rows[invite_id]["admin_invite_pending"] is False


# ── Two-step setup finished ──────────────────────────────────────────────────


def _enrolled(client, user_id, secret="s3cret"):
    return client.post(
        "/admin/two-factor/enrolled",
        json={"user_id": user_id},
        headers={"X-Internal-Auth-Sync-Secret": secret},
    )


def test_enrolled_writes_nothing_while_two_factor_is_off(db, invited):
    client, invite_id, token, code = invited
    _accept(client, invite_id, token, code)

    assert _enrolled(client, invite_id).json() == {"recorded": False}
    assert "admin.two_factor_enrolled" not in _actions(db)


def test_enrolled_is_logged_once_per_setup(db, invited):
    client, invite_id, token, code = invited
    _accept(client, invite_id, token, code)
    user = db.query(User).filter_by(external_auth_id=invite_id).one()
    set_identity(db, user, twoFactorEnabled=True)

    assert _enrolled(client, invite_id).json() == {"recorded": True}
    assert _enrolled(client, invite_id).json() == {"recorded": False}
    assert _actions(db, user.id).count("admin.two_factor_enrolled") == 1


def test_enrolled_needs_the_internal_secret(db, invited):
    client, invite_id, _token, _code = invited
    assert _enrolled(client, invite_id, secret="wrong").status_code in (401, 403)

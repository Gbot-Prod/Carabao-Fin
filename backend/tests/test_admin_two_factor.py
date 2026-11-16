"""E8c: admins need two-step verification for the admin API.

CF-0017: the session must also have passed the TOTP step (the mfa claim).
CF-0018: 2FA setup needs a one-time link that only an admin action makes.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin
from app.models.user import User
from app.services import admin_enrolment
from app.services.better_auth_store import enrolment_identifier
from tests.better_auth import get_identity, make_user
from tests.test_reviews import db  # noqa: F401 - fixture
from tests.tokens import ADMIN_KEY, bearer, make_token, trust_test_key


def _admin_client(db, user) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(admin.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _admin(db, two_factor=False) -> User:  # noqa: F811
    """An admin whose BetterAuth user has 2FA on or off."""
    user = make_user(db, "admin@example.com", is_admin=True, two_factor=two_factor)
    db.commit()
    return user


def test_admin_without_two_factor_is_told_to_turn_it_on(db, monkeypatch):  # noqa: F811
    res = _admin_client(db, _admin(db)).get("/admin/stats")
    assert res.status_code == 403
    assert "Two-step verification is required" in res.json()["detail"]


def test_admin_with_two_factor_gets_in(db, monkeypatch):  # noqa: F811
    res = _admin_client(db, _admin(db, two_factor=True)).get("/admin/stats")
    assert res.status_code == 200, res.text


def test_no_switch_turns_the_requirement_off(db, monkeypatch):  # noqa: F811
    # CF-0003: the old ADMIN_REQUIRE_2FA switch no longer
    # lets an admin in without two-step verification.
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "false")
    res = _admin_client(db, _admin(db)).get("/admin/stats")
    assert res.status_code == 403


def test_non_admin_still_gets_admin_only(db, monkeypatch):  # noqa: F811
    buyer = make_user(db, "b@example.com", two_factor=True)
    buyer.token_surface = "admin"  # signed in on the admin site
    db.commit()
    res = _admin_client(db, buyer).get("/admin/stats")
    assert res.status_code == 403 and res.json()["detail"] == "Admin only"


def _token_client(db, monkeypatch) -> TestClient:  # noqa: F811
    trust_test_key(monkeypatch)
    app = FastAPI()
    app.include_router(admin.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def test_two_factor_is_read_live_from_better_auth(db, monkeypatch):  # noqa: F811
    make_user(
        db, "admin@example.com", identity_id="ba_admin", is_admin=True, two_factor=True
    )
    db.commit()
    client = _token_client(db, monkeypatch)

    def stats(**claims):
        return client.get(
            "/admin/stats",
            headers=bearer(
                sub="ba_admin",
                email="admin@example.com",
                mfa=True,
                key=ADMIN_KEY,
                **claims,
            ),
        ).status_code

    assert stats() == 200
    # Turned off in BetterAuth: access ends at once, even with a token that was
    # issued while it was on.
    db.execute(text('UPDATE "user" SET "twoFactorEnabled" = 0'))
    db.commit()
    assert stats(twoFactorEnabled=True) == 403


# ── CF-0017: the token must come from a session that passed the TOTP step ───


@pytest.mark.parametrize("mfa", [None, False, "true", 1])
def test_admin_token_without_the_totp_step_is_refused(db, monkeypatch, mfa):  # noqa: F811
    # e.g. a Google sign-in (mfa false) or a session from before this change
    # (no claim). Only the JSON value true counts.
    make_user(db, "admin@example.com", identity_id="ba_admin", is_admin=True)
    db.commit()
    res = _token_client(db, monkeypatch).get(
        "/admin/stats", headers=bearer(sub="ba_admin", mfa=mfa, key=ADMIN_KEY)
    )
    assert res.status_code == 403
    assert res.json()["detail"] == admin.ADMIN_MFA_SESSION_DETAIL


def test_admin_token_after_the_totp_step_gets_in(db, monkeypatch):  # noqa: F811
    make_user(db, "admin@example.com", identity_id="ba_admin", is_admin=True)
    db.commit()
    res = _token_client(db, monkeypatch).get(
        "/admin/stats", headers=bearer(sub="ba_admin", mfa=True, key=ADMIN_KEY)
    )
    assert res.status_code == 200, res.text


# ── Subdomains: the admin API needs a token from the admin web deploy ───────
# The surface comes only from the key set that verified the token
# (app/core/security.py, documentation/manuals/SUBDOMAINS.md).


def test_public_site_token_gets_nothing_from_the_admin_api(db, monkeypatch):  # noqa: F811
    # A real admin, 2FA on, TOTP step passed, but signed in on the public site.
    make_user(db, "admin@example.com", identity_id="ba_admin", is_admin=True)
    db.commit()
    res = _token_client(db, monkeypatch).get(
        "/admin/stats", headers=bearer(sub="ba_admin", mfa=True)
    )
    assert res.status_code == 403
    assert res.json()["detail"] == admin.ADMIN_SURFACE_DETAIL


def test_admin_site_token_for_a_non_admin_is_refused(db, monkeypatch):  # noqa: F811
    make_user(db, "b@example.com", identity_id="ba_buyer", two_factor=True)
    db.commit()
    res = _token_client(db, monkeypatch).get(
        "/admin/stats", headers=bearer(sub="ba_buyer", mfa=True, key=ADMIN_KEY)
    )
    assert res.status_code == 403
    assert res.json()["detail"] == "Admin only"


@pytest.mark.parametrize("path", ["/admin/stats", "/admin/users"])
def test_public_key_with_an_admin_surface_claim_is_401(db, monkeypatch, path):  # noqa: F811
    make_user(db, "admin@example.com", identity_id="ba_admin", is_admin=True)
    db.commit()
    forged = make_token(sub="ba_admin", mfa=True, surface="admin")  # public key set
    res = _token_client(db, monkeypatch).get(path, headers=bearer(forged))
    assert res.status_code == 401


def test_admin_key_with_a_public_surface_claim_is_401(db, monkeypatch):  # noqa: F811
    make_user(db, "admin@example.com", identity_id="ba_admin", is_admin=True)
    db.commit()
    token = make_token(sub="ba_admin", mfa=True, surface="public", key=ADMIN_KEY)
    res = _token_client(db, monkeypatch).get("/admin/stats", headers=bearer(token))
    assert res.status_code == 401


def test_admin_key_with_the_admin_claim_gets_in(db, monkeypatch):  # noqa: F811
    make_user(db, "admin@example.com", identity_id="ba_admin", is_admin=True)
    db.commit()
    token = make_token(sub="ba_admin", mfa=True, surface="admin", key=ADMIN_KEY)
    res = _token_client(db, monkeypatch).get("/admin/stats", headers=bearer(token))
    assert res.status_code == 200, res.text


# ── CF-0018: setup links ─────────────────────────────────────────────────────


@pytest.fixture
def sent(monkeypatch):
    """Setup links are captured, not sent."""
    out: list[tuple[str, str, str]] = []
    monkeypatch.setenv("BETTER_AUTH_URL", "https://web.test")
    # The enrol page is on the admin site.
    monkeypatch.setenv("ADMIN_URL", "https://admin.web.test")
    monkeypatch.setattr(
        admin_enrolment,
        "send_sms",
        lambda *, number, message: out.append(("sms", number, message)),
    )
    monkeypatch.setattr(
        admin_enrolment,
        "send_admin_enrolment_email",
        lambda to, url: out.append(("email", to, url)),
    )
    return out


def _enrolment_row(db, user):  # noqa: F811
    return (
        db.execute(
            text('SELECT value FROM "verification" WHERE identifier = :i'),
            {"i": enrolment_identifier(user.external_auth_id)},
        )
        .mappings()
        .first()
    )


def _token_from(message: str) -> str:
    return message.split("token=")[1].split()[0]


def _set_role(client, user, is_admin=True):
    return client.patch(f"/admin/users/{user.id}/role", json={"is_admin": is_admin})


def test_promotion_sends_a_one_time_setup_link_by_sms_and_email(db, sent):  # noqa: F811
    boss = _admin(db, two_factor=True)
    user = make_user(db, "new@example.com")
    db.commit()

    res = _set_role(_admin_client(db, boss), user)

    assert res.status_code == 200, res.text
    assert res.json()["is_admin"] is True
    assert [s[0] for s in sent] == ["sms", "email"]
    assert sent[0][1] == user.phone_number and sent[1][1] == "new@example.com"
    url = sent[1][2]
    assert url.startswith("https://admin.web.test/two-factor/enrol?token=")
    token = _token_from(url)
    assert _token_from(sent[0][2]) == token
    # Only the hash is kept, for BetterAuth to check on /two-factor/enable.
    assert _enrolment_row(db, user)["value"] == admin_enrolment.hash_token(token)
    assert admin_enrolment.hash_token(token) != token


def test_promotion_needs_a_verified_contact(db, sent):  # noqa: F811
    boss = _admin(db, two_factor=True)
    # A Google account with an unverified email and no number.
    user = make_user(db, "g@example.com", email_verified=False, phone_number=None)
    db.commit()

    res = _set_role(_admin_client(db, boss), user)

    assert res.status_code == 400
    assert res.json()["detail"] == admin_enrolment.NO_CONTACT_DETAIL
    assert get_identity(db, user.external_auth_id)["role"] == "user"
    assert sent == []


def test_promotion_by_email_only_when_there_is_no_number(db, sent):  # noqa: F811
    boss = _admin(db, two_factor=True)
    user = make_user(db, "g@example.com", phone_number=None)
    db.commit()
    assert _set_role(_admin_client(db, boss), user).status_code == 200
    assert [s[0] for s in sent] == ["email"]


def test_link_not_sent_is_reported_but_the_role_is_kept(db, monkeypatch, sent):  # noqa: F811
    def fail(**_):
        raise RuntimeError("Semaphore down")

    monkeypatch.setattr(admin_enrolment, "send_sms", fail)
    boss = _admin(db, two_factor=True)
    user = make_user(db, None)  # phone only
    db.commit()

    res = _set_role(_admin_client(db, boss), user)

    assert res.status_code == 502
    assert res.json()["detail"] == admin_enrolment.NOT_SENT_DETAIL
    assert get_identity(db, user.external_auth_id)["role"] == "admin"


def _with_two_factor(db, user):  # noqa: F811
    params = {"u": user.external_auth_id}
    db.execute(
        text(
            'INSERT INTO "twoFactor" (id, secret, "backupCodes", "userId") '
            "VALUES ('tf1', 's', 'c', :u)"
        ),
        params,
    )
    db.execute(
        text(
            'INSERT INTO "verification" (id, identifier, value, "expiresAt") '
            "VALUES ('v1', 'trust-device-abc', :u, '2999-01-01')"
        ),
        params,
    )
    db.execute(text('INSERT INTO "session" (id, "userId") VALUES (\'s1\', :u)'), params)
    db.commit()


def _count(db, sql, user) -> int:  # noqa: F811
    return db.execute(text(sql), {"u": user.external_auth_id}).scalar()


def _assert_two_factor_cleared(db, user):  # noqa: F811
    assert not get_identity(db, user.external_auth_id)["twoFactorEnabled"]
    assert _count(db, 'SELECT COUNT(*) FROM "twoFactor" WHERE "userId" = :u', user) == 0
    assert _count(db, 'SELECT COUNT(*) FROM "session" WHERE "userId" = :u', user) == 0
    # Trusted devices go too, so the next sign-in asks for a code.
    assert _count(db, 'SELECT COUNT(*) FROM "verification" WHERE value = :u', user) == 0


def test_demotion_turns_two_factor_off_and_ends_sessions(db, sent):  # noqa: F811
    boss = _admin(db, two_factor=True)
    other = make_user(db, "other@example.com", is_admin=True)
    db.commit()
    _with_two_factor(db, other)

    res = _set_role(_admin_client(db, boss), other, is_admin=False)

    assert res.status_code == 200, res.text
    assert res.json()["is_admin"] is False
    _assert_two_factor_cleared(db, other)
    assert sent == []


def test_reset_sends_a_new_link_and_clears_the_old_setup(db, sent):  # noqa: F811
    boss = _admin(db, two_factor=True)
    other = make_user(db, "other@example.com", is_admin=True)
    db.commit()
    _with_two_factor(db, other)
    client = _admin_client(db, boss)

    res = client.post(f"/admin/users/{other.id}/two-factor/reset")

    assert res.status_code == 200, res.text
    assert res.json() == {"sent_to": ["sms", "email"]}
    _assert_two_factor_cleared(db, other)
    first = _token_from(sent[-1][2])
    assert _enrolment_row(db, other)["value"] == admin_enrolment.hash_token(first)

    # A second reset replaces the link: the old token no longer matches.
    assert client.post(f"/admin/users/{other.id}/two-factor/reset").status_code == 200
    second = _token_from(sent[-1][2])
    assert second != first
    assert _enrolment_row(db, other)["value"] == admin_enrolment.hash_token(second)


def test_new_link_before_setup_keeps_the_admin_signed_in(db, sent):  # noqa: F811
    boss = _admin(db, two_factor=True)
    other = make_user(db, "other@example.com", is_admin=True, two_factor=False)
    db.commit()
    db.execute(
        text('INSERT INTO "session" (id, "userId") VALUES (\'s2\', :u)'),
        {"u": other.external_auth_id},
    )
    db.commit()

    res = _admin_client(db, boss).post(f"/admin/users/{other.id}/two-factor/reset")

    assert res.status_code == 200, res.text
    assert _count(db, 'SELECT COUNT(*) FROM "session" WHERE "userId" = :u', other) == 1
    token = _token_from(sent[-1][2])
    assert _enrolment_row(db, other)["value"] == admin_enrolment.hash_token(token)


def test_reset_rules(db, sent):  # noqa: F811
    boss = _admin(db, two_factor=True)
    buyer = make_user(db, "b@example.com")
    db.commit()
    client = _admin_client(db, boss)

    assert client.post(f"/admin/users/{boss.id}/two-factor/reset").status_code == 400
    assert client.post(f"/admin/users/{buyer.id}/two-factor/reset").status_code == 400
    assert client.post("/admin/users/999999/two-factor/reset").status_code == 404
    assert sent == []

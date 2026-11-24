"""E8c: admins need two-step verification for the admin API.

CF-0017: the session must also have passed the TOTP step (the mfa claim).
Invites, account reset, deactivation and reactivation (which make the
setup links): tests/test_admin_accounts.py.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin
from app.models.user import User
from tests.better_auth import make_user
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

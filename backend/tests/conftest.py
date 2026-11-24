import base64
import importlib
import os
import pkgutil

# CF-0050 (B55): every test uses its own SQLite engine, but app.core.database
# refuses to import without DATABASE_URL. Set a harmless default first, so a
# clean checkout or worktree with no .env can run the suite. load_dotenv()
# never overrides a set variable, so a local .env can't point tests at Postgres.
os.environ.setdefault("DATABASE_URL", "sqlite://")

import app.core.database  # noqa: E402,F401  runs load_dotenv() once

# CF-0050 (B30): load_dotenv() copies a developer's .env into os.environ, and
# some of these are read when a module is first imported (rate_limit LIMITS),
# so a per-test monkeypatch is too late. Drop the values that change test
# outcomes, and the service keys, so a test that forgets a mock can't reach a
# real service. Tests that need one set it with monkeypatch.
_DOTENV_LEAKS = (
    "ACCOUNT_OTP_PER_HOUR",
    "ORDER_AUTO_CONFIRM_DAYS",
    "ORDER_RESERVATION_TTL_MINUTES",
    "PAYOUT_TRANSFER_FEE",
    "RATE_LIMIT_TRUST_PROXY",
    "REVIEW_WINDOW_DAYS",
    "PAYMONGO_SECRET_KEY",
    "PAYMONGO_SECRET_TEST_KEY",
    "PAYMONGO_WEBHOOK_SECRET",
    "SEMAPHORE_KEY",
    "RESEND_KEY",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "MAPBOX_ACCESS_TOKEN",
    "ANTHROPIC_API_KEY",  # guardrails Phase 4 vision check
    "OSRM_URL",
    "ROAD_SNAP_MAX_METERS",
)
for _name in _DOTENV_LEAKS:
    os.environ.pop(_name, None)
# Pin road check off: tests that set MAPBOX_ACCESS_TOKEN must not snap pins.
# test_pin_quality turns it on with monkeypatch.
os.environ["ROAD_SNAP_PROVIDER"] = "off"

import sqlite3  # noqa: E402
from datetime import date, datetime  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402
from app.core import field_crypto  # noqa: E402
from app.models.otp import OtpCode, RateLimitHit  # noqa: E402

# CF-0092: plain SQL (better_auth_store) sends datetime/date values straight to
# sqlite3, whose built-in adapters are deprecated since Python 3.12. Register
# the same text forms by hand (the sqlite3 docs recipe), so stored values do not
# change. Postgres (psycopg) in production does not use these adapters.
# pyproject makes the deprecation warning an error, so a new case fails here.
sqlite3.register_adapter(datetime, lambda value: value.isoformat(" "))
sqlite3.register_adapter(date, lambda value: value.isoformat())

# CF-0033: shared db / merchant / buyer fixtures for every test module.
pytest_plugins = ["tests.shared_fixtures"]

# Every model, so relationships by name (User -> "Cart") resolve in any test run.
for _module in pkgutil.iter_modules(app.models.__path__):
    importlib.import_module(f"app.models.{_module.name}")


@pytest.fixture
def otp_db():
    """CF-0016: an empty SQLite database with only the OTP and rate-limit tables."""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    OtpCode.metadata.create_all(
        engine, tables=[OtpCode.__table__, RateLimitHit.__table__]
    )
    session = sessionmaker(bind=engine)()
    yield session
    session.close()
    engine.dispose()


@pytest.fixture(autouse=True)
def r2_deleted(monkeypatch):
    """CF-0040: R2 deletes are recorded, never sent to a real bucket."""
    from app.services import r2_service

    deleted: list[str] = []
    monkeypatch.setattr(r2_service, "delete_private_document", deleted.append)
    return deleted


@pytest.fixture(autouse=True)
def _field_keys(monkeypatch):
    """CF-0007: fixed test keys for TIN / RSBSA number encryption."""
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", base64.b64encode(b"e" * 32).decode())
    monkeypatch.setenv("FIELD_HMAC_KEY", base64.b64encode(b"h" * 32).decode())
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY_PREVIOUS", raising=False)
    field_crypto.reset_keys()
    yield
    field_crypto.reset_keys()


@pytest.fixture(autouse=True)
def _jwks_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    """CF-0033: key-set URLs come from BETTER_AUTH_URL, not the developer's .env.

    load_dotenv() (app.core.database) puts PUBLIC_JWKS_URL / ADMIN_JWKS_URL from
    a local .env into os.environ, which pointed the JWKS tests at localhost.
    Tests that need an override set it themselves.
    """
    monkeypatch.delenv("PUBLIC_JWKS_URL", raising=False)
    monkeypatch.delenv("ADMIN_JWKS_URL", raising=False)
    monkeypatch.delenv("ADMIN_JWKS_THUMBPRINTS", raising=False)


@pytest.fixture(autouse=True)
def _payout_sms(monkeypatch):
    """CF-0004: payout-change codes and alerts are captured, not texted.
    Account-deletion codes too."""
    from app.services import account_deletion_otp, payout_otp
    from tests import payout_codes

    payout_codes.SENT.clear()
    payout_codes.EMAILS.clear()
    monkeypatch.setenv(
        "AUTH_SYNC_SHARED_SECRET",
        os.environ.get("AUTH_SYNC_SHARED_SECRET") or "test-secret",
    )
    monkeypatch.setattr(payout_otp, "send_otp", payout_codes.fake_send_otp)
    monkeypatch.setattr(
        account_deletion_otp, "send_otp", payout_codes.fake_send_otp
    )
    monkeypatch.setattr(payout_otp, "send_sms", payout_codes.fake_send_sms)
    monkeypatch.setattr(
        payout_otp,
        "send_payout_change_email",
        payout_codes.fake_send_payout_change_email,
    )
    return payout_codes.SENT

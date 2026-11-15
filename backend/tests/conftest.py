import os
import base64
import importlib
import pkgutil

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models
from app.core import field_crypto
from app.models.otp import OtpCode, RateLimitHit

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
def _field_keys(monkeypatch):
    """CF-0007: fixed test keys for TIN / RSBSA number encryption."""
    monkeypatch.setenv("FIELD_ENCRYPTION_KEY", base64.b64encode(b"e" * 32).decode())
    monkeypatch.setenv("FIELD_HMAC_KEY", base64.b64encode(b"h" * 32).decode())
    monkeypatch.delenv("FIELD_ENCRYPTION_KEY_PREVIOUS", raising=False)
    field_crypto.reset_keys()
    yield
    field_crypto.reset_keys()


@pytest.fixture(autouse=True)
def _payout_sms(monkeypatch):
    """CF-0004: payout-change codes and alerts are captured, not texted."""
    from app.services import payout_otp
    from tests import payout_codes

    payout_codes.SENT.clear()
    payout_codes.EMAILS.clear()
    monkeypatch.setenv(
        "AUTH_SYNC_SHARED_SECRET",
        os.environ.get("AUTH_SYNC_SHARED_SECRET") or "test-secret",
    )
    monkeypatch.setattr(payout_otp, "send_otp", payout_codes.fake_send_otp)
    monkeypatch.setattr(payout_otp, "send_sms", payout_codes.fake_send_sms)
    monkeypatch.setattr(
        payout_otp,
        "send_payout_change_email",
        payout_codes.fake_send_payout_change_email,
    )
    return payout_codes.SENT

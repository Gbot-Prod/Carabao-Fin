import pytest

from app.services import rate_limit


@pytest.fixture(autouse=True)
def _admin_two_factor_off(monkeypatch):
    """E8c: admin endpoints require 2FA; tests opt back in where they check it."""
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "false")
    # The feature itself is off by default in the app; the E8 tests check it on.
    monkeypatch.setenv("TWO_FACTOR_ENABLED", "true")


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """E7: every test starts with empty rate-limit counters."""
    rate_limit.reset()
    yield
    rate_limit.reset()

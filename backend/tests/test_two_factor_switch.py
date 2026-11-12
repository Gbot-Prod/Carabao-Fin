"""Two-step verification is built (E8) but switched off by default."""

from app.api.routes.admin import admin_requires_two_factor
from app.services.features import two_factor_enabled


def test_off_by_default(monkeypatch):
    monkeypatch.delenv("TWO_FACTOR_ENABLED", raising=False)
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "true")
    assert two_factor_enabled() is False
    # Admins aren't required to have it while the feature is off.
    assert admin_requires_two_factor() is False


def test_switching_it_on(monkeypatch):
    monkeypatch.setenv("TWO_FACTOR_ENABLED", "true")
    monkeypatch.setenv("ADMIN_REQUIRE_2FA", "true")
    assert two_factor_enabled() is True
    assert admin_requires_two_factor() is True

import pytest

from app.services import rate_limit


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    """E7: every test starts with empty rate-limit counters."""
    rate_limit.reset()
    yield
    rate_limit.reset()

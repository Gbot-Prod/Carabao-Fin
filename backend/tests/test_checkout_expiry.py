from types import SimpleNamespace

import pytest

from app.services import order_reservations, paymongo


class FakeResponse:
    def __init__(self, status_code: int):
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


@pytest.fixture(autouse=True)
def paymongo_key(monkeypatch):
    monkeypatch.setenv("PAYMONGO_USE_TEST", "false")
    monkeypatch.setenv("PAYMONGO_SECRET_KEY", "sk_test")


def _stub_expire(monkeypatch, status_code: int, session_status: str = "active"):
    calls = []

    def fake_post(url, **_):
        calls.append(url)
        return FakeResponse(status_code)

    monkeypatch.setattr(paymongo.requests, "post", fake_post)
    monkeypatch.setattr(
        paymongo,
        "retrieve_checkout_session",
        lambda _id: {"attributes": {"status": session_status}},
    )
    return calls


def test_expire_succeeds(monkeypatch):
    calls = _stub_expire(monkeypatch, 200)
    assert paymongo.expire_checkout_session("cs_1") is True
    assert calls == [f"{paymongo.PAYMONGO_BASE_URL}/checkout_sessions/cs_1/expire"]


def test_expire_already_expired_counts_as_closed(monkeypatch):
    _stub_expire(monkeypatch, 400, session_status="expired")
    assert paymongo.expire_checkout_session("cs_1") is True


def test_expire_refused_while_payment_in_progress(monkeypatch):
    _stub_expire(monkeypatch, 400, session_status="active")
    assert paymongo.expire_checkout_session("cs_1") is False


def test_expire_unknown_session_counts_as_closed(monkeypatch):
    _stub_expire(monkeypatch, 404)
    assert paymongo.expire_checkout_session("cs_1") is True


def test_expire_server_error_raises(monkeypatch):
    _stub_expire(monkeypatch, 502)
    with pytest.raises(RuntimeError):
        paymongo.expire_checkout_session("cs_1")


def test_release_keeps_stock_when_session_cannot_be_closed(monkeypatch):
    monkeypatch.setattr(
        order_reservations, "close_checkout_sessions", lambda _order, _db: False
    )
    order = SimpleNamespace(id=1, status="pending", items=[], current_order=None)

    released = order_reservations.release_order_reservation(
        order, db=None, transaction_status="expired"
    )

    assert released is False
    assert order.status == "pending"


def test_reservation_ttl_reads_env(monkeypatch):
    monkeypatch.setenv("ORDER_RESERVATION_TTL_MINUTES", "15")
    assert order_reservations.reservation_ttl_minutes() == 15

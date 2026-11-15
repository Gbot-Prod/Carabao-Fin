"""PR 4 hygiene: request IDs (CF-0013), money (CF-0014), docs off (CF-0015)."""

import importlib
import logging
from decimal import Decimal

import pytest
import requests
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.errors import REQUEST_ID_HEADER, upstream_error
from app.schemas.produce import ProduceCreate, ProduceUpdate
from app.services import money, paymongo

# ── CF-0013 ────────────────────────────────────────────────────────────────


def _app_with(route):
    import main

    app = FastAPI()
    app.middleware("http")(main.request_id_and_errors_middleware)
    app.get("/boom")(route)
    return TestClient(app, raise_server_exceptions=False)


def test_upstream_error_is_generic_and_logged_under_the_request_id(caplog):
    def route():
        try:
            raise RuntimeError("PayMongo said: sk_live_secret is invalid")
        except RuntimeError as exc:
            raise upstream_error(
                502, "Payment failed", log="PayMongo", exc=exc
            ) from exc

    with caplog.at_level(logging.ERROR):
        resp = _app_with(route).get("/boom")
    request_id = resp.headers[REQUEST_ID_HEADER]
    assert resp.status_code == 502
    assert resp.json()["detail"] == f"Payment failed (reference: {request_id})"
    assert "sk_live_secret" not in resp.text
    logged = [r for r in caplog.records if request_id in r.getMessage()]
    assert logged and "sk_live_secret" in str(logged[0].exc_info[1])


def test_unhandled_error_returns_request_id():
    def route():
        raise ValueError("database password is hunter2")

    resp = _app_with(route).get("/boom")
    assert resp.status_code == 500
    assert "hunter2" not in resp.text
    assert resp.json()["request_id"] == resp.headers[REQUEST_ID_HEADER]


def test_safe_caller_request_id_is_kept_and_unsafe_one_replaced():
    def route():
        raise HTTPException(status_code=404, detail="nope")

    client = _app_with(route)
    kept = client.get("/boom", headers={REQUEST_ID_HEADER: "abc-123-def-456"})
    assert kept.headers[REQUEST_ID_HEADER] == "abc-123-def-456"
    replaced = client.get("/boom", headers={REQUEST_ID_HEADER: "bad id\r\nX: y"})
    assert replaced.headers[REQUEST_ID_HEADER] != "bad id\r\nX: y"


# ── CF-0014 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("amount", "fee"),
    [(25, 1), (75, 2), (125, 3), (100, 2), (0, 0), (1, 0)],
)
def test_platform_fee_rounds_half_up(amount, fee):
    # 2% of 125 is 2.5: round() gives 2 (to even), half up gives 3.
    assert money.platform_fee(amount) == fee


@pytest.mark.parametrize(
    "bad", [None, "", "abc", float("nan"), float("inf"), -1, True, [], "1e999999"]
)
def test_invalid_amounts_raise(bad):
    with pytest.raises(money.InvalidAmount):
        money.whole_pesos(bad)


def test_fractional_pesos_are_not_whole():
    with pytest.raises(money.InvalidAmount):
        money.whole_pesos(12.5)
    assert money.round_pesos("12.5") == 13
    assert money.whole_pesos("40") == 40


def test_centavos_boundary():
    assert money.to_centavos(1499) == 149_900
    assert money.to_centavos(Decimal("0.01")) == 1
    assert money.from_centavos(149_950) == Decimal("1499.5")
    for bad in (0, -5, "x"):
        with pytest.raises(money.InvalidAmount):
            money.to_centavos(bad)


def test_checkout_with_zero_amount_never_reaches_paymongo(monkeypatch):
    def fail(*_, **__):
        raise AssertionError("PayMongo must not be called")

    monkeypatch.setattr(requests, "post", fail)
    with pytest.raises(money.InvalidAmount):
        paymongo.create_checkout_session(
            amount_pesos=0,
            description="x",
            merchant_name="y",
            success_url="https://a",
            cancel_url="https://b",
        )


def test_cart_total_raises_on_bad_price():
    from app.models.cart import Cart

    assert Cart(items=[{"price": 40, "quantity": 3}]).total_price == 120
    with pytest.raises(money.InvalidAmount):
        _ = Cart(items=[{"price": "abc", "quantity": 1}]).total_price


def test_listing_price_must_be_positive():
    base = {"name": "Talong", "harvest_date": "2026-11-10", "best_before": "2026-11-20"}
    with pytest.raises(ValidationError):
        ProduceCreate(**base)  # no price: not silently 0
    for bad in (0, -10, 12.5):
        with pytest.raises(ValidationError):
            ProduceCreate(**base, price=bad)
        with pytest.raises(ValidationError):
            ProduceUpdate(price=bad)
    assert ProduceCreate(**base, price=45).price == 45


# ── CF-0015 ────────────────────────────────────────────────────────────────


def _reload_main(monkeypatch, app_env):
    import main

    if app_env is None:
        monkeypatch.delenv("APP_ENV", raising=False)
    else:
        monkeypatch.setenv("APP_ENV", app_env)
    return importlib.reload(main)


# CF-0023: fail closed. Unset, misspelled or unknown values give production.
@pytest.mark.parametrize("app_env", [None, "", "prod", "staging", "Production "])
def test_docs_off_unless_explicit_dev(monkeypatch, app_env):
    try:
        main = _reload_main(monkeypatch, app_env)
        assert main._is_dev is False
        client = TestClient(main.app)
        assert client.get("/openapi.json").status_code == 404
    finally:
        _reload_main(monkeypatch, "development")


@pytest.mark.parametrize("app_env", ["development", "local", " Local "])
def test_dev_mode_only_for_dev_values(monkeypatch, app_env):
    try:
        assert _reload_main(monkeypatch, app_env)._is_dev is True
    finally:
        _reload_main(monkeypatch, "development")


def test_docs_off_in_production(monkeypatch):
    try:
        main = _reload_main(monkeypatch, "production")
        client = TestClient(main.app)
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code == 404
    finally:
        _reload_main(monkeypatch, "development")


def test_docs_on_in_development(monkeypatch):
    main = _reload_main(monkeypatch, "development")
    client = TestClient(main.app)
    assert client.get("/openapi.json").status_code == 200
    assert client.get("/docs").status_code == 200

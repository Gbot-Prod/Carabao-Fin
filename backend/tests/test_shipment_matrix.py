"""Tests for the shipment road-matrix fetch and the shipment size cap."""

import asyncio

import pytest
from pydantic import ValidationError

from app.api.routes import shipments
from app.schemas.shipment import MAX_SHIPMENT_ORDERS, CreateShipmentRequest

COORDS = [(14.62, 121.05), (14.63, 121.06), (14.60, 121.03)]


class _FakeResponse:
    def __init__(self, status: int, body: dict):
        self.status_code = status
        self.ok = status < 400
        self._body = body

    def json(self) -> dict:
        return self._body


def _fetch(monkeypatch, response=None, exc=None, token="pk.test"):
    calls = []

    def fake_get(url, params, timeout):
        calls.append((url, params))
        if exc:
            raise exc
        return response

    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", token)
    monkeypatch.setattr(shipments._requests, "get", fake_get)
    return asyncio.run(shipments._get_duration_matrix(COORDS)), calls


def test_returns_duration_matrix_from_single_request(monkeypatch):
    matrix = [[0, 60, 90], [70, 0, 40], [95, 45, 0]]
    result, calls = _fetch(
        monkeypatch, _FakeResponse(200, {"code": "Ok", "durations": matrix})
    )
    assert result == matrix
    assert len(calls) == 1
    url, params = calls[0]
    assert "directions-matrix/v1/mapbox/driving/121.05,14.62;" in url
    assert params["annotations"] == "duration"


def test_http_error_returns_none(monkeypatch):
    result, _ = _fetch(monkeypatch, _FakeResponse(429, {"message": "rate limited"}))
    assert result is None


def test_network_failure_returns_none(monkeypatch):
    result, _ = _fetch(monkeypatch, exc=shipments._requests.exceptions.ConnectTimeout())
    assert result is None


def test_wrong_size_matrix_returns_none(monkeypatch):
    result, _ = _fetch(
        monkeypatch, _FakeResponse(200, {"code": "Ok", "durations": [[0, 1], [1, 0]]})
    )
    assert result is None


def test_missing_token_returns_none_without_request(monkeypatch):
    result, calls = _fetch(monkeypatch, token="")
    assert result is None
    assert calls == []


def test_shipment_request_caps_order_count():
    CreateShipmentRequest(order_ids=list(range(MAX_SHIPMENT_ORDERS)))
    with pytest.raises(ValidationError):
        CreateShipmentRequest(order_ids=list(range(MAX_SHIPMENT_ORDERS + 1)))


def test_cap_fits_one_mapbox_matrix_request():
    # Mapbox Matrix (driving profile) accepts at most 25 coordinates.
    assert MAX_SHIPMENT_ORDERS + 1 <= 25

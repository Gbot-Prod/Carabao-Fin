"""CF-0059: Mapbox logs hold no token or address, bounded offsets, one order
reference format."""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import Any

import pytest
import requests
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import notifications as notifications_routes
from app.api.routes import reviews as reviews_routes
from app.models.order import Order
from app.models.transaction import Transaction
from app.schemas.pagination import MAX_OFFSET
from app.services import mapbox_routing, notifications, refund_service
from app.utils import geocoding

TOKEN = "pk.secret-token-123"
ADDRESS = "12 Mabini St, Malolos, Bulacan"


class _Resp:
    def __init__(self, status: int, body: dict[str, Any]) -> None:
        self.status_code = status
        self.ok = status < 400
        self._body = body

    def json(self) -> dict[str, Any]:
        return self._body


def _leaky_error(url: str, params: dict[str, Any], timeout: float) -> None:
    # requests puts the URL (with the query string) in its messages.
    raise requests.ConnectionError(
        f"failed {url}?access_token={params['access_token']}"
    )


def test_geocode_logs_hold_no_address_coordinates_or_token(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", TOKEN)
    monkeypatch.setattr(time, "sleep", lambda _s: None)
    monkeypatch.setattr(requests, "get", _leaky_error)

    with caplog.at_level(logging.DEBUG):
        assert geocoding._geocode_sync(ADDRESS) is None
    assert "unavailable" in caplog.text
    assert TOKEN not in caplog.text
    assert "Mabini" not in caplog.text

    caplog.clear()
    found = {
        "features": [
            {"center": [120.8113, 14.8433], "relevance": 0.3, "place_name": ADDRESS}
        ]
    }
    monkeypatch.setattr(
        requests, "get", lambda url, params, timeout: _Resp(200, found)
    )
    with caplog.at_level(logging.DEBUG):
        assert geocoding._geocode_sync(ADDRESS) == (14.8433, 120.8113)
    assert "Mabini" not in caplog.text
    assert "14.84" not in caplog.text and "120.81" not in caplog.text


def test_route_helpers_log_no_token(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", TOKEN)
    monkeypatch.setattr(requests, "get", _leaky_error)
    coords = [(14.6, 121.0), (14.7, 121.1)]

    with caplog.at_level(logging.WARNING, logger=mapbox_routing.__name__):
        assert mapbox_routing.duration_matrix(coords) is None
        assert mapbox_routing.leg_durations(coords) is None
    assert "mapbox matrix failed: ConnectionError" in caplog.text
    assert "mapbox directions failed: ConnectionError" in caplog.text
    assert TOKEN not in caplog.text


def test_routes_use_the_one_helper() -> None:
    from app.api.routes import merchants, shipments

    assert merchants._get_leg_durations is mapbox_routing.leg_durations
    assert shipments._get_leg_durations is mapbox_routing.leg_durations
    assert shipments._get_duration_matrix is mapbox_routing.duration_matrix


def _client(db: Session, user: Any) -> TestClient:
    app = FastAPI()
    app.include_router(notifications_routes.router)
    app.include_router(reviews_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_offsets_are_bounded(db: Session, merchant: Any, buyer: Any) -> None:
    client = _client(db, buyer[0])
    too_far = MAX_OFFSET + 1
    for path in (
        "/users/me/notifications",
        f"/merchants/{merchant.id}/reviews",
        "/merchants/me/reviews",
    ):
        assert client.get(path, params={"offset": too_far}).status_code == 422, path
        assert client.get(path, params={"offset": 2**63}).status_code == 422, path
    assert client.get(
        "/users/me/notifications", params={"offset": MAX_OFFSET}
    ).status_code == 200
    assert client.get(
        f"/merchants/{merchant.id}/reviews", params={"offset": MAX_OFFSET}
    ).status_code == 200


def test_order_reference_is_built_once() -> None:
    when = datetime(2026, 11, 19, 3, 0, tzinfo=UTC)
    assert notifications.format_order_ref(42, when) == "CB-2026-0042"
    assert notifications.format_order_ref(42, None) == "CB-XXXX-0042"
    assert notifications.format_order_ref(12345, when) == "CB-2026-12345"

    order: Any = Order(id=42, ordered_at=when)
    txn: Any = Transaction(order_id=42)
    txn.order = order
    assert notifications.order_ref(order) == "CB-2026-0042"
    assert refund_service.order_ref(txn) == "CB-2026-0042"

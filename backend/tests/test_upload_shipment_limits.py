"""CF-0060: action limits on image uploads and shipment create (B66, B67).

Each test shrinks the scope's limit, then checks the 429, that a blocked call
reached neither R2 nor the merchant lookup (so no geocoding or Mapbox), and
that the count is per user.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import merchants as merchant_routes
from app.api.routes import shipments as shipment_routes
from app.api.routes import users as user_routes
from app.models.produce import Produce
from app.models.shopPage import ShopPage
from app.services import merchant_service, r2_service, rate_limit
from tests.files import png_bytes
from tests.shared_fixtures import _buyer


def _shrink(monkeypatch: pytest.MonkeyPatch, scope: str, max_hits: int) -> None:
    monkeypatch.setitem(rate_limit.ACTION_LIMITS, scope, rate_limit.Limit(max_hits, 60))


def _app(db: Session, user: Any) -> TestClient:
    app = FastAPI()
    for router in (user_routes.router, merchant_routes.router, shipment_routes.router):
        app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _png(field: str) -> dict[str, tuple[str, bytes, str]]:
    return {field: ("a.png", png_bytes(), "image/png")}


def _assert_limited(res: Any) -> None:
    assert res.status_code == 429, res.text
    assert res.json()["detail"].startswith("Too many requests.")
    assert int(res.headers["Retry-After"]) >= 1


@pytest.fixture
def r2_calls(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    def fake(name: str) -> Any:
        def upload(*_args: Any, **_kwargs: Any) -> str:
            calls.append(name)
            return f"https://cdn.example/{name}.png"

        return upload

    for name in (
        "upload_avatar",
        "upload_shop_logo",
        "upload_banner",
        "upload_produce_image",
    ):
        monkeypatch.setattr(r2_service, name, fake(name))
    return calls


def test_uploads_share_one_limit_per_user(
    db: Session, merchant: Any, monkeypatch: pytest.MonkeyPatch, r2_calls: list[str]
) -> None:
    _shrink(monkeypatch, "image_upload", 3)
    db.add(ShopPage(merchant_id=merchant.id, title="Farm", slug="farm"))
    produce = Produce(
        merchant_id=merchant.id, name="Talong", price=50, stock_quantity=5
    )
    db.add(produce)
    db.commit()
    owner = merchant.user
    client = _app(db, owner)

    assert client.post("/users/me/avatar", files=_png("avatar")).status_code == 200
    logo = client.post("/merchants/me/shoppage/logo", files=_png("logo"))
    assert logo.status_code == 200, logo.text
    image = client.post(f"/produce/{produce.id}/image", files=_png("image"))
    assert image.status_code == 200, image.text
    assert len(r2_calls) == 3

    # The 4th upload, on any of the routes, is refused before R2.
    _assert_limited(client.post("/merchants/me/shoppage/banner", files=_png("banner")))
    _assert_limited(client.post("/users/me/avatar", files=_png("avatar")))
    assert len(r2_calls) == 3

    # Another person is not affected.
    other, _ = _buyer(db, "other@example.com")
    res = _app(db, other).post("/users/me/avatar", files=_png("avatar"))
    assert res.status_code == 200, res.text
    assert len(r2_calls) == 4


def test_shipment_create_is_limited_before_any_lookup(
    db: Session, merchant: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    _shrink(monkeypatch, "shipment_create", 2)
    lookups: list[int] = []
    real_lookup = merchant_service.get_active_merchant

    def counting_lookup(session: Session, user_id: int) -> Any:
        lookups.append(user_id)
        return real_lookup(session, user_id)

    monkeypatch.setattr(shipment_routes, "get_active_merchant", counting_lookup)
    client = _app(db, merchant.user)
    body = {"order_ids": [999_001]}

    # Allowed calls go on to the normal checks (no such order here).
    for _ in range(2):
        assert client.post("/merchants/me/shipments", json=body).status_code != 429
    assert len(lookups) == 2

    _assert_limited(client.post("/merchants/me/shipments", json=body))
    assert len(lookups) == 2  # blocked before the farm, geocoding and Mapbox

    other, _ = _buyer(db, "other@example.com")
    res = _app(db, other).post("/merchants/me/shipments", json=body)
    assert res.status_code == 404  # not a merchant, but not limited


def test_new_limits_leave_room_for_real_use() -> None:
    limits = rate_limit.ACTION_LIMITS
    # A farm adding its listings with photos in one sitting.
    assert limits["image_upload"].max_hits >= 50
    assert limits["shipment_create"].max_hits >= 20
    assert limits["shipment_create"].window_seconds == 3600

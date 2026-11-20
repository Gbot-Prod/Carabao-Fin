"""CF-0081 (B64): one public listing, its farm, and other farms selling the
same produce."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes import produce_search
from app.models.produce import Produce
from app.services.produce_freshness import ph_today
from tests.test_merchant_listings import _other_merchant
from tests.test_public_farm_list import _farm


def _client(db: Session) -> TestClient:
    app = FastAPI()
    app.include_router(produce_search.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _item(db: Session, merchant: Any, name: str, price: int, **extra: Any) -> Produce:
    row = Produce(
        merchant_id=merchant.id, name=name, price=price, stock_quantity=5, **extra
    )
    db.add(row)
    db.commit()
    return row


def test_listing_with_its_farm_and_cheapest_other_farms(
    db: Session, merchant: Any
) -> None:
    mine = _item(db, merchant, "Talong", 60)
    rival: Any = _other_merchant(db)
    third: Any = _farm(db, 3)
    fourth: Any = _farm(db, 4)
    cheap = _item(db, rival, " talong ", 45)  # same produce, other spelling
    dear = _item(db, third, "TALONG", 80)
    _item(db, fourth, "Talong", 30, hidden_at=datetime.now(UTC))  # hidden
    _item(
        db, fourth, "Talong", 20, best_before=ph_today() - timedelta(days=1)
    )  # expired
    _item(db, rival, "Kamatis", 10)  # other produce
    _item(db, merchant, "Talong", 55)  # same farm: not an "other farm"
    fourth.paused_until = ph_today() + timedelta(days=2)
    paused = _item(db, fourth, "Talong", 70)

    res = _client(db).get(f"/produce/{mine.id}")

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["listing"]["id"] == mine.id
    assert body["farm"]["merchant_name"] == merchant.merchant_name
    # The listing links to the farm by slug: /farms/<slug>.
    assert body["farm"]["slug"] == merchant.shop_page.slug
    assert "address" not in body["farm"] and "contact_number" not in body["farm"]
    others = [(o["id"], o["price"]) for o in body["other_farms"]]
    assert others == [(cheap.id, 45), (paused.id, 70), (dear.id, 80)]
    by_id = {o["id"]: o for o in body["other_farms"]}
    assert by_id[paused.id]["merchant_paused_until"] is not None  # listed, labelled


def test_unlisted_listing_is_404(db: Session, merchant: Any) -> None:
    hidden = _item(db, merchant, "Talong", 60, hidden_at=datetime.now(UTC))
    expired = _item(
        db, merchant, "Kamatis", 40, best_before=ph_today() - timedelta(days=1)
    )
    client = _client(db)
    for produce_id in (hidden.id, expired.id, 999_999):
        assert client.get(f"/produce/{produce_id}").status_code == 404
    merchant.suspended_at = datetime.now(UTC)
    db.commit()
    shown = _item(db, merchant, "Okra", 30)
    assert client.get(f"/produce/{shown.id}").status_code == 404  # suspended farm


def test_search_route_still_wins_over_the_id_route(db: Session, merchant: Any) -> None:
    _item(db, merchant, "Talong", 60)
    res = _client(db).get("/produce/search", params={"q": "talong"})
    assert res.status_code == 200
    assert res.json()["total"] == 1


def test_our_web_server_is_not_rate_limited(
    db: Session, merchant: Any, monkeypatch: Any
) -> None:
    """CF-0084: page renders all come from one IP; only they skip the limit."""
    from app.services import rate_limit

    monkeypatch.setitem(
        rate_limit.ACTION_LIMITS, "produce_search", rate_limit.Limit(1, 60)
    )
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "s3cret")
    item = _item(db, merchant, "Talong", 60)
    client = _client(db)
    url = f"/produce/{item.id}"

    assert client.get(url).status_code == 200
    assert client.get(url).status_code == 429  # a normal visitor is limited
    ours = {"X-Internal-Auth-Sync-Secret": "s3cret"}
    for _ in range(3):
        assert client.get(url, headers=ours).status_code == 200
    wrong = {"X-Internal-Auth-Sync-Secret": "guess"}
    assert client.get(url, headers=wrong).status_code == 429
    # A non-ASCII value is a wrong secret, not a server error.
    odd = {b"X-Internal-Auth-Sync-Secret": "s3crét".encode("latin-1")}
    assert client.get(url, headers=odd).status_code == 429
    monkeypatch.delenv("AUTH_SYNC_SHARED_SECRET")
    assert (
        client.get(url, headers={"X-Internal-Auth-Sync-Secret": ""}).status_code == 429
    )

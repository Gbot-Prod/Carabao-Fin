"""CF-0091 (B96): listing ids for sitemap.xml."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.api.routes import produce_search
from app.services.produce_freshness import ph_today
from tests.test_listing_detail import _client, _item
from tests.test_merchant_listings import _other_merchant


def test_only_orderable_listings_lowest_id_first(db: Session, merchant: Any) -> None:
    rival: Any = _other_merchant(db)
    b = _item(db, rival, "Kamatis", 40)
    a = _item(db, merchant, "Talong", 60)
    _item(db, merchant, "Okra", 30, hidden_at=datetime.now(UTC))  # hidden
    _item(
        db, merchant, "Sitaw", 20, best_before=ph_today() - timedelta(days=1)
    )  # expired
    rival.paused_until = ph_today() + timedelta(days=2)  # paused: still listed
    db.commit()

    res = _client(db).get("/produce/sitemap-ids")

    assert res.status_code == 200, res.text
    assert res.json() == sorted([a.id, b.id])

    rival.suspended_at = datetime.now(UTC)  # a farm buyers may not see
    db.commit()
    assert _client(db).get("/produce/sitemap-ids").json() == [a.id]


def test_capped(db: Session, merchant: Any, monkeypatch: Any) -> None:
    monkeypatch.setattr(produce_search, "SITEMAP_LISTINGS_MAX", 2)
    ids = [_item(db, merchant, f"Item {n}", 10).id for n in range(3)]
    assert _client(db).get("/produce/sitemap-ids").json() == ids[:2]


def test_rate_limited_except_for_our_web_server(
    db: Session, merchant: Any, monkeypatch: Any
) -> None:
    from app.services import rate_limit

    monkeypatch.setitem(
        rate_limit.ACTION_LIMITS, "produce_search", rate_limit.Limit(1, 60)
    )
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "s3cret")
    client = _client(db)
    assert client.get("/produce/sitemap-ids").status_code == 200
    assert client.get("/produce/sitemap-ids").status_code == 429
    ours = {"X-Internal-Auth-Sync-Secret": "s3cret"}
    assert client.get("/produce/sitemap-ids", headers=ours).status_code == 200

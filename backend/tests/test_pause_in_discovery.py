"""CF-0072 (B81): holiday mode shows in search."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.services.produce_freshness import ph_today
from tests.test_produce_search import client, listings  # noqa: F401 - fixtures


def test_search_results_carry_the_pause(
    db: Session, merchant: Any, client: Any, listings: Any  # noqa: F811
) -> None:
    until = ph_today() + timedelta(days=3)
    merchant.paused_until = until
    db.commit()

    items = client.get("/produce/search").json()["items"]

    by_farm = {i["merchant_id"]: i["merchant_paused_until"] for i in items}
    assert by_farm[merchant.id] == until.isoformat()
    assert any(v is None for k, v in by_farm.items() if k != merchant.id)
    # Still listed: a paused farm can be found, it just takes no orders.
    assert merchant.id in by_farm


def test_an_ended_pause_is_not_shown(
    db: Session, merchant: Any, client: Any, listings: Any  # noqa: F811
) -> None:
    merchant.paused_until = ph_today() - timedelta(days=1)
    db.commit()
    items = client.get("/produce/search").json()["items"]
    assert all(i["merchant_paused_until"] is None for i in items)


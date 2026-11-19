"""CF-0072 (B81, B83): holiday mode shows in search, and the voucher preview
does not promise a discount checkout would refuse."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.services.produce_freshness import ph_today
from tests.test_produce_search import client, listings  # noqa: F401 - fixtures
from tests.test_vouchers import _cart, _client, _voucher


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


def test_preview_gives_no_discount_for_a_paused_farm(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    _cart(db, user, merchant)
    _voucher(db, merchant, code="SAVE10", value=10)
    merchant.paused_until = ph_today()
    db.commit()

    res = _client(db, user).post(
        "/orders/me/voucher-preview", json={"voucher_code": "SAVE10"}
    )

    assert res.status_code == 400
    assert res.json()["detail"] == "Cart is empty"

"""CF-0039: admin order/transaction date filters use Manila calendar days.

Before, ``date_from``/``date_to`` were naive midnights, read as UTC by
Postgres, so a "Nov 18" filter left out 00:00-08:00 Manila on the 18th and
took in 00:00-08:00 Manila on the 19th.
"""

import logging
from datetime import UTC, date, datetime

import pytest
import requests
from sqlalchemy.orm import Session

from app.api.routes import merchants
from app.models.merchant import Merchant
from app.services.produce_freshness import ph_day_start
from tests import test_admin_orders as ao
from tests import test_admin_transactions as at
from tests.shared_fixtures import _buyer

# Instants around Manila's Nov 18 (UTC+8): it runs 17th 16:00 to 18th 16:00 UTC.
EARLY_18 = datetime(2026, 11, 17, 23, 30, tzinfo=UTC)  # 07:30 on the 18th, Manila
LATE_18 = datetime(2026, 11, 18, 15, 30, tzinfo=UTC)  # 23:30 on the 18th, Manila
EARLY_19 = datetime(2026, 11, 18, 16, 30, tzinfo=UTC)  # 00:30 on the 19th, Manila
LATE_17 = datetime(2026, 11, 17, 15, 30, tzinfo=UTC)  # 23:30 on the 17th, Manila


def test_ph_day_start_is_utc_instant_of_manila_midnight() -> None:
    start = ph_day_start(date(2026, 11, 18))
    assert start == datetime(2026, 11, 17, 16, tzinfo=UTC)
    assert start.utcoffset() == UTC.utcoffset(None)


def test_admin_orders_one_day_filter_is_the_manila_day(
    db: Session, merchant: Merchant
) -> None:
    buyer = _buyer(db)
    inside = [ao._order(db, merchant, buyer, ordered_at=t) for t in (EARLY_18, LATE_18)]
    for t in (EARLY_19, LATE_17):
        ao._order(db, merchant, buyer, ordered_at=t)
    client = ao._client(db, ao._admin(db))

    got = ao._ids(client.get("/admin/orders?date_from=2026-11-18&date_to=2026-11-18"))
    assert got == sorted(o.id for o in inside)


def test_admin_transactions_one_day_filter_is_the_manila_day(
    db: Session, merchant: Merchant
) -> None:
    buyer = _buyer(db)
    order = ao._order(db, merchant, buyer)
    inside = [at._txn(db, order, "paid", created_at=t) for t in (EARLY_18, LATE_18)]
    for t in (EARLY_19, LATE_17):
        at._txn(db, order, "paid", created_at=t)
    client = at._client(db, ao._admin(db))

    url = "/admin/transactions?date_from=2026-11-18&date_to=2026-11-18"
    assert at._ids(client.get(url)) == sorted(t.id for t in inside)
    export = client.get(url.replace("/transactions?", "/transactions/export?"))
    assert export.status_code == 200
    # Header row + the two Manila-day rows.
    assert len(export.text.strip().splitlines()) == 3


def test_directions_failure_is_logged_without_token(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """CF-0039 (B41): module logger, not print; the URL/token stays out."""
    monkeypatch.setenv("MAPBOX_ACCESS_TOKEN", "pk.secret-token")

    def boom(url: str, params: dict[str, str], timeout: float) -> None:
        token = params["access_token"]
        raise requests.ConnectionError(f"failed {url}?access_token={token}")

    monkeypatch.setattr(requests, "get", boom)  # mapbox_routing imports it as _requests
    # CF-0059: the helper moved to services/mapbox_routing; merchants uses it.
    with caplog.at_level(logging.WARNING, logger="app.services.mapbox_routing"):
        assert merchants._get_leg_durations([(14.6, 121.0), (14.7, 121.1)]) is None
    assert "mapbox directions failed" in caplog.text
    assert "secret-token" not in caplog.text

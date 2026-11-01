from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.services import order_status
from app.services.order_status import (
    MERCHANT_TRANSITIONS,
    auto_confirm_delivered_orders,
    mark_delivered,
    mark_shipped,
)


def _order(order_id: int, status: str, shipped_days_ago: float | None = None):
    shipped_at = (
        datetime.now(UTC) - timedelta(days=shipped_days_ago)
        if shipped_days_ago is not None
        else None
    )
    return SimpleNamespace(
        id=order_id,
        status=status,
        shipped_at=shipped_at,
        delivered_at=None,
        delivery_confirmed_by=None,
        current_order=SimpleNamespace(status=status),
    )


class FakeQuery:
    """Answers the two query shapes the sweep issues: id scan, then row lock."""

    def __init__(self, orders, wants_ids):
        self._orders = orders
        self._wants_ids = wants_ids
        self._locked_id = None

    def filter(self, *criteria):
        if not self._wants_ids:
            # filter(Order.id == order_id): pull the bound id off the clause.
            self._locked_id = criteria[0].right.value
        return self

    def with_for_update(self):
        return self

    def all(self):
        cutoff = datetime.now(UTC) - timedelta(days=self._days)
        return [
            (o.id,)
            for o in self._orders
            if o.status in order_status.IN_TRANSIT_STATUSES
            and o.shipped_at is not None
            and o.shipped_at < cutoff
        ]

    def first(self):
        return next((o for o in self._orders if o.id == self._locked_id), None)


class FakeSession:
    def __init__(self, orders, days):
        self.orders = orders
        self.days = days

    def query(self, entity):
        wants_ids = entity is order_status.Order.id
        query = FakeQuery(self.orders, wants_ids)
        query._days = self.days
        return query


@pytest.mark.parametrize("status", ["shipped", "out_for_delivery"])
def test_merchant_cannot_mark_delivered(status):
    assert "delivered" not in MERCHANT_TRANSITIONS[status]


def test_no_merchant_transition_reaches_delivered():
    assert all("delivered" not in nxt for nxt in MERCHANT_TRANSITIONS.values())


def test_mark_shipped_sets_timestamp_once():
    order = _order(1, "processing")
    mark_shipped(order)
    first = order.shipped_at
    assert order.status == order.current_order.status == "shipped"
    assert first is not None

    mark_shipped(order)
    assert order.shipped_at == first


def test_mark_delivered_records_who_confirmed():
    order = _order(1, "shipped", shipped_days_ago=1)
    mark_delivered(order, confirmed_by="buyer")
    assert order.status == order.current_order.status == "delivered"
    assert order.delivered_at is not None
    assert order.delivery_confirmed_by == "buyer"


def test_auto_confirm_only_confirms_orders_past_window():
    due = _order(1, "shipped", shipped_days_ago=8)
    due_ofd = _order(2, "out_for_delivery", shipped_days_ago=7.5)
    recent = _order(3, "shipped", shipped_days_ago=2)
    cancelled = _order(4, "cancelled", shipped_days_ago=30)
    never_shipped = _order(5, "shipped")
    db = FakeSession([due, due_ofd, recent, cancelled, never_shipped], days=7)

    assert auto_confirm_delivered_orders(db, 7) == 2
    assert due.delivery_confirmed_by == due_ofd.delivery_confirmed_by == "auto"
    assert recent.status == "shipped"
    assert cancelled.status == "cancelled"
    assert never_shipped.status == "shipped"


def test_auto_confirm_is_idempotent():
    due = _order(1, "shipped", shipped_days_ago=10)
    db = FakeSession([due], days=7)

    assert auto_confirm_delivered_orders(db, 7) == 1
    confirmed_at = due.delivered_at
    assert auto_confirm_delivered_orders(db, 7) == 0
    assert due.delivered_at == confirmed_at


def test_auto_confirm_days_reads_env(monkeypatch):
    monkeypatch.delenv("ORDER_AUTO_CONFIRM_DAYS", raising=False)
    assert order_status.auto_confirm_days() == 7
    monkeypatch.setenv("ORDER_AUTO_CONFIRM_DAYS", "3")
    assert order_status.auto_confirm_days() == 3

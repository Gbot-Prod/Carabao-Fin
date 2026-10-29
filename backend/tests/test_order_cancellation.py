from types import SimpleNamespace

from app.models.transaction import Transaction
from app.services import order_reservations


class FakeQuery:
    def __init__(self, db, model):
        self.db = db
        self.model = model
        self.criteria = []

    def filter(self, *criteria):
        self.criteria.extend(criteria)
        return self

    def with_for_update(self):
        return self

    def first(self):
        produce_id = self.criteria[0].right.value
        return self.db.produce.get(produce_id)

    def update(self, values, **_):
        self.db.updates.append((self.criteria, values))
        return 1


class FakeDB:
    def __init__(self, produce):
        self.produce = produce
        self.updates = []

    def query(self, model):
        return FakeQuery(self, model)


def _order(status="processing"):
    return SimpleNamespace(
        id=7,
        status=status,
        items=[{"produce_id": 1, "quantity": 3}, {"produceId": "2", "quantity": 2}],
        current_order=SimpleNamespace(status=status),
    )


def _transaction_update(db):
    assert len(db.updates) == 1
    criteria, values = db.updates[0]
    status_filter = next(c for c in criteria if c.left.key == "status")
    return status_filter.right.value, values[Transaction.status]


def test_cancel_order_restores_stock_and_flags_paid_transaction_for_refund():
    tomatoes = SimpleNamespace(stock_quantity=10)
    onions = SimpleNamespace(stock_quantity=0)
    db = FakeDB({1: tomatoes, 2: onions})
    order = _order()

    order_reservations.cancel_order(order, db)

    assert order.status == "cancelled"
    assert order.current_order.status == "cancelled"
    assert tomatoes.stock_quantity == 13
    assert onions.stock_quantity == 2
    assert _transaction_update(db) == ("paid", "refund_pending")


def test_release_reservation_still_restores_stock(monkeypatch):
    monkeypatch.setattr(
        order_reservations, "close_checkout_sessions", lambda _order, _db: True
    )
    tomatoes = SimpleNamespace(stock_quantity=10)
    db = FakeDB({1: tomatoes})
    order = _order(status="pending")

    released = order_reservations.release_order_reservation(
        order, db, transaction_status="expired"
    )

    assert released is True
    assert order.status == "cancelled"
    assert tomatoes.stock_quantity == 13
    assert _transaction_update(db) == ("pending", "expired")

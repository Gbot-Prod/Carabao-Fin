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


def test_cancel_pending_order_closes_checkout(monkeypatch):
    closed = []
    monkeypatch.setattr(
        order_reservations,
        "close_checkout_sessions",
        lambda order, _db: closed.append(order.id) or True,
    )
    tomatoes = SimpleNamespace(stock_quantity=10)
    db = FakeDB({1: tomatoes})
    order = _order(status="pending")

    assert order_reservations.cancel_order(order, db) is True

    assert closed == [7]
    assert order.status == "cancelled"
    assert tomatoes.stock_quantity == 13
    assert _transaction_update(db) == ("pending", "expired")


def test_cancel_pending_order_refused_while_payment_in_progress(monkeypatch):
    monkeypatch.setattr(
        order_reservations, "close_checkout_sessions", lambda _order, _db: False
    )
    tomatoes = SimpleNamespace(stock_quantity=10)
    db = FakeDB({1: tomatoes})
    order = _order(status="pending")

    assert order_reservations.cancel_order(order, db) is False

    assert order.status == "pending"
    assert tomatoes.stock_quantity == 10
    assert db.updates == []


class SettleDB:
    def __init__(self, order, cart):
        self.rows = {"Order": order, "Cart": cart, "OrderHistory": None}
        self.refreshed = []

    def query(self, model):
        row = self.rows[model.__name__]
        query = SimpleNamespace(first=lambda: row)
        query.filter = lambda *_: query
        query.with_for_update = lambda: query
        return query

    def refresh(self, instance, with_for_update=None):
        self.refreshed.append(with_for_update)


def _txn(status="pending"):
    return SimpleNamespace(
        id=3, order_id=7, user_id=5, status=status, paymongo_payment_id=None
    )


def _settle_order(status):
    return SimpleNamespace(
        status=status,
        current_order=SimpleNamespace(status=status),
        order_history_id=None,
    )


def test_payment_moves_pending_order_to_processing():
    order = _settle_order("pending")
    cart = SimpleNamespace(items=[{"produce_id": 1}])
    txn = _txn()
    db = SettleDB(order, cart)

    outcome = order_reservations.settle_checkout_payment(txn, "pay_1", db)

    assert outcome == "paid"
    assert db.refreshed == [True]
    assert txn.status == "paid"
    assert txn.paymongo_payment_id == "pay_1"
    assert order.status == "processing"
    assert order.current_order.status == "processing"
    assert cart.items == []


def test_payment_on_cancelled_order_is_flagged_for_refund():
    order = _settle_order("cancelled")
    cart = SimpleNamespace(items=[{"produce_id": 1}])
    txn = _txn()

    outcome = order_reservations.settle_checkout_payment(
        txn, "pay_1", SettleDB(order, cart)
    )

    assert outcome == "refund"
    assert txn.status == "refund_pending"
    assert txn.paymongo_payment_id == "pay_1"
    assert order.status == "cancelled"
    assert order.current_order.status == "cancelled"
    assert cart.items == [{"produce_id": 1}]


def test_payment_on_expired_transaction_is_flagged_for_refund():
    order = _settle_order("pending")
    txn = _txn(status="expired")

    outcome = order_reservations.settle_checkout_payment(
        txn, "pay_1", SettleDB(order, None)
    )

    assert outcome == "refund"
    assert txn.status == "refund_pending"
    assert order.status == "pending"


def test_duplicate_payment_event_is_ignored():
    txn = _txn(status="paid")
    txn.paymongo_payment_id = "pay_1"

    outcome = order_reservations.settle_checkout_payment(
        txn, "pay_2", SettleDB(_settle_order("processing"), None)
    )

    assert outcome == "duplicate"
    assert txn.paymongo_payment_id == "pay_1"

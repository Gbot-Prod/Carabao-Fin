"""GET /payments/transactions/order/{id} reconciles with PayMongo.

The mobile app has no webhook-driven redirect: it closes the in-app browser and
polls this endpoint, so a missed webhook must still surface as "paid".
"""

from types import SimpleNamespace

import pytest
import requests

from app.api.routes import payments
from app.models.statuses import TransactionStatus


class FakeDB:
    def __init__(self):
        self.commits = 0

    def commit(self):
        self.commits += 1


@pytest.fixture
def settled(monkeypatch):
    calls = []

    def fake_settle(txn, payment_id, _db):
        calls.append((txn.id, payment_id))
        txn.status = TransactionStatus.PAID
        return "paid"

    monkeypatch.setattr(payments, "settle_checkout_payment", fake_settle)
    monkeypatch.setattr(payments, "notify_merchant_new_order", lambda order: None)
    return calls


def _txn(status=TransactionStatus.PENDING, session_id="cs_1"):
    return SimpleNamespace(
        id=7, order_id=3, status=status, paymongo_session_id=session_id, order=None
    )


def _session(monkeypatch, status, payments_list=None):
    monkeypatch.setattr(
        payments,
        "retrieve_checkout_session",
        lambda _id: {"attributes": {"status": status, "payments": payments_list or []}},
    )


def test_pending_txn_becomes_paid_when_session_paid(monkeypatch, settled):
    # Real PayMongo shape: the session stays "active"; its payment is "paid".
    _session(monkeypatch, "active", [{"id": "pay_9", "attributes": {"status": "paid"}}])
    txn, db = _txn(), FakeDB()

    payments._reconcile_transaction_from_paymongo(txn, db)

    assert settled == [(7, "pay_9")]
    assert txn.status == TransactionStatus.PAID
    assert db.commits == 1


def test_paid_intent_counts_as_paid(monkeypatch, settled):
    monkeypatch.setattr(
        payments,
        "retrieve_checkout_session",
        lambda _id: {
            "attributes": {
                "status": "active",
                "payments": [{"id": "pay_5"}],
                "payment_intent": {"attributes": {"status": "succeeded"}},
            }
        },
    )
    txn, db = _txn(), FakeDB()

    payments._reconcile_transaction_from_paymongo(txn, db)

    assert settled == [(7, "pay_5")]


def test_failed_payment_leaves_txn_pending(monkeypatch, settled):
    _session(monkeypatch, "active", [{"id": "pay_1", "attributes": {"status": "failed"}}])
    txn, db = _txn(), FakeDB()

    payments._reconcile_transaction_from_paymongo(txn, db)

    assert settled == []
    assert db.commits == 0


def test_unpaid_session_leaves_txn_pending(monkeypatch, settled):
    _session(monkeypatch, "active")
    txn, db = _txn(), FakeDB()

    payments._reconcile_transaction_from_paymongo(txn, db)

    assert settled == []
    assert txn.status == TransactionStatus.PENDING
    assert db.commits == 0


@pytest.mark.parametrize(
    "status", [TransactionStatus.PAID, TransactionStatus.EXPIRED, TransactionStatus.FAILED]
)
def test_settled_txn_is_not_rechecked(monkeypatch, settled, status):
    def boom(_id):
        raise AssertionError("PayMongo should not be called")

    monkeypatch.setattr(payments, "retrieve_checkout_session", boom)
    payments._reconcile_transaction_from_paymongo(_txn(status=status), FakeDB())
    assert settled == []


def test_paymongo_outage_keeps_txn_pending(monkeypatch, settled):
    def down(_id):
        raise requests.ConnectionError("down")

    monkeypatch.setattr(payments, "retrieve_checkout_session", down)
    txn = _txn()

    payments._reconcile_transaction_from_paymongo(txn, FakeDB())

    assert txn.status == TransactionStatus.PENDING
    assert settled == []

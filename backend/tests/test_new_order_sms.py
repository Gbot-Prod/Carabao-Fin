"""The farmer gets one SMS when a PayMongo test-mode payment settles an order."""

import hashlib
import hmac
import json
import time
from datetime import date, datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_db
from app.api.routes import payments
from app.api.webhooks import paymongo as paymongo_webhook
from app.services import sms_service

WEBHOOK_SECRET = "whsk_test_secret"
SESSION_ID = "cs_test_123"


class FakeDB:
    """Just enough Session for the webhook and settle_checkout_payment."""

    def __init__(self, txn, order):
        self.rows = {"Transaction": txn, "Order": order, "OrderHistory": None, "Cart": None}
        self.commits = 0

    def query(self, model):
        row = self.rows[model.__name__]
        query = SimpleNamespace(first=lambda: row)
        query.filter = lambda *_: query
        query.with_for_update = lambda: query
        return query

    def refresh(self, instance, with_for_update=None):
        pass

    def commit(self):
        self.commits += 1


def _order(status="pending", phone="09171234567"):
    return SimpleNamespace(
        id=42,
        status=status,
        order_history_id=None,
        ordered_at=datetime(2026, 11, 12, 9, 30),
        items=[{"produce": "Tomato", "quantity": 2}, {"produce": "Okra", "quantity": 1}],
        total_price=1540,
        requested_delivery_date=date(2026, 11, 14),
        delivery_window="08:00 – 10:00",
        merchant=SimpleNamespace(contact_number=phone),
    )


def _txn(order, status="pending"):
    return SimpleNamespace(
        id=3,
        order_id=order.id,
        user_id=5,
        status=status,
        paymongo_payment_id=None,
        paymongo_session_id=SESSION_ID,
        order=order,
    )


def _paid_event() -> bytes:
    return json.dumps(
        {
            "data": {
                "attributes": {
                    "type": "checkout_session.payment.paid",
                    "livemode": False,
                    "data": {
                        "id": SESSION_ID,
                        "attributes": {"payments": [{"id": "pay_test_1"}], "status": "paid"},
                    },
                }
            }
        }
    ).encode()


def _signature(body: bytes, field: str = "te") -> str:
    ts = str(int(time.time()))
    digest = hmac.new(
        WEBHOOK_SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256
    ).hexdigest()
    # PayMongo fills `te` for test-mode events and `li` for live ones.
    return f"t={ts},te={digest if field == 'te' else ''},li={digest if field == 'li' else ''}"


@pytest.fixture
def sent(monkeypatch):
    messages = []
    monkeypatch.setattr(sms_service, "send_sms", lambda **kw: messages.append(kw))
    return messages


@pytest.fixture
def test_mode(monkeypatch):
    monkeypatch.setenv("PAYMONGO_USE_TEST", "true")
    monkeypatch.setenv("PAYMONGO_WEBHOOK_SECRET", WEBHOOK_SECRET)


def _client(db):
    app = FastAPI()
    app.include_router(paymongo_webhook.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _post(client, body, field="te"):
    return client.post(
        "/webhooks/paymongo",
        content=body,
        headers={"Paymongo-Signature": _signature(body, field), "Content-Type": "application/json"},
    )


def test_test_mode_payment_sends_farmer_one_sms(test_mode, sent):
    order = _order()
    db = FakeDB(_txn(order), order)

    response = _post(_client(db), _paid_event())

    assert response.status_code == 200
    assert order.status == "processing"
    assert db.commits == 1
    assert sent == [
        {
            "number": "09171234567",
            "message": (
                "New Carabao order CB-2026-0042: 3 item(s), PHP 1,540. "
                "Deliver Nov 14, 08:00 - 10:00. Open your dashboard for details."
            ),
        }
    ]


def test_replayed_webhook_does_not_resend(test_mode, sent):
    order = _order()
    txn = _txn(order)
    client = _client(FakeDB(txn, order))
    body = _paid_event()

    _post(client, body)
    _post(client, body)  # PayMongo retries deliveries

    assert len(sent) == 1


def test_live_signature_rejected_in_test_mode(test_mode, sent):
    order = _order()
    db = FakeDB(_txn(order), order)

    response = _post(_client(db), _paid_event(), field="li")

    assert response.status_code == 400
    assert order.status == "pending"
    assert sent == []


def test_payment_on_cancelled_order_sends_no_sms(test_mode, sent):
    order = _order(status="cancelled")
    txn = _txn(order)

    response = _post(_client(FakeDB(txn, order)), _paid_event())

    assert response.status_code == 200
    assert txn.status == "refund_pending"
    assert sent == []


def test_merchant_without_number_is_skipped(test_mode, sent):
    order = _order(phone=None)

    response = _post(_client(FakeDB(_txn(order), order)), _paid_event())

    assert response.status_code == 200
    assert order.status == "processing"
    assert sent == []


def test_sms_failure_does_not_break_payment(test_mode, monkeypatch):
    def boom(**_):
        raise sms_service.SemaphoreError("no credits")

    monkeypatch.setattr(sms_service, "send_sms", boom)
    order = _order()
    db = FakeDB(_txn(order), order)

    response = _post(_client(db), _paid_event())

    assert response.status_code == 200
    assert order.status == "processing"
    assert db.commits == 1


def test_missed_webhook_reconcile_also_notifies(sent, monkeypatch):
    order = _order()
    txn = _txn(order)
    monkeypatch.setattr(
        payments,
        "retrieve_checkout_session",
        lambda _sid: {
            "attributes": {
                "status": "active",
                "payments": [{"id": "pay_test_1", "attributes": {"status": "paid"}}],
            }
        },
    )

    payments._reconcile_transaction_from_paymongo(txn, FakeDB(txn, order))

    assert txn.status == "paid"
    assert len(sent) == 1

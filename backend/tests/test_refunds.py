"""A2: the admin refund queue and recording a refund."""

import pytest

from app.models.transaction import Transaction
from app.services import refund_service
from tests.test_admin_orders import _admin, _client, _order, _txn
from tests.test_reviews import _buyer, db, merchant  # noqa: F401 - fixtures


@pytest.fixture
def sent(monkeypatch):
    out = {"email": [], "sms": []}
    monkeypatch.setattr(
        refund_service.email,
        "send_refund_email",
        lambda to, **kw: out["email"].append({"to": to, **kw}),
    )
    monkeypatch.setattr(refund_service, "send_sms", lambda **kw: out["sms"].append(kw))
    return out


def _pending(db, merchant):
    user, history = _buyer(db)
    user.phone_number = "639171112222"
    db.commit()
    order = _order(db, merchant, (user, history), "cancelled")
    return _txn(db, order, "refund_pending")


def test_lists_only_refund_pending(db, merchant, sent):
    txn = _pending(db, merchant)
    paid_order = _order(db, merchant, _buyer(db, email="b2@example.com"))
    _txn(db, paid_order, "paid")
    res = _client(db, _admin(db)).get("/admin/refunds")
    assert res.status_code == 200, res.text
    body = res.json()
    assert [r["transaction_id"] for r in body] == [txn.id]
    assert body[0]["buyer_email"] == "buyer@example.com"
    assert body[0]["merchant_name"] == "Dela Cruz Farm"


def test_record_refund_marks_refunded_and_notifies(db, merchant, sent):
    txn = _pending(db, merchant)
    admin = _admin(db)
    client = _client(db, admin)
    res = client.post(
        f"/admin/refunds/{txn.id}",
        json={"method": "gcash", "reference": " GC-123456 ", "notes": "Full refund"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "refunded"

    db.expire_all()
    stored = db.get(Transaction, txn.id)
    assert stored.status == "refunded"
    assert stored.refund_method == "gcash"
    assert stored.refund_reference == "GC-123456"
    assert stored.refunded_by == admin.id
    assert stored.refunded_at is not None

    assert sent["email"][0]["to"] == "buyer@example.com"
    assert sent["email"][0]["reference"] == "GC-123456"
    assert sent["sms"][0]["number"] == "639171112222"
    assert "GC-123456" in sent["sms"][0]["message"]

    assert client.get("/admin/refunds").json() == []
    done = client.get("/admin/refunds?status=refunded").json()
    assert [r["refund_reference"] for r in done] == ["GC-123456"]


def test_cannot_refund_twice_or_refund_a_paid_payment(db, merchant, sent):
    txn = _pending(db, merchant)
    client = _client(db, _admin(db))
    payload = {"method": "bank_transfer", "reference": "BDO-1"}
    assert client.post(f"/admin/refunds/{txn.id}", json=payload).status_code == 200
    assert client.post(f"/admin/refunds/{txn.id}", json=payload).status_code == 409

    paid = _txn(db, _order(db, merchant, _buyer(db, email="b3@example.com")), "paid")
    assert client.post(f"/admin/refunds/{paid.id}", json=payload).status_code == 409
    assert client.post("/admin/refunds/999", json=payload).status_code == 404
    assert len(sent["email"]) == 1


def test_requires_method_and_reference(db, merchant, sent):
    txn = _pending(db, merchant)
    client = _client(db, _admin(db))
    bad = [
        {"method": "gcash", "reference": ""},
        {"method": "gcash", "reference": "   "},
        {"method": "crypto", "reference": "X"},
        {"reference": "X"},
    ]
    for payload in bad:
        res = client.post(f"/admin/refunds/{txn.id}", json=payload)
        assert res.status_code == 422, (payload, res.text)
    assert db.get(Transaction, txn.id).status == "refund_pending"
    assert sent["email"] == [] and sent["sms"] == []


def test_notification_failure_does_not_undo_refund(db, merchant, monkeypatch):
    txn = _pending(db, merchant)

    def boom(*_, **__):
        raise RuntimeError("resend down")

    monkeypatch.setattr(refund_service.email, "send_refund_email", boom)
    monkeypatch.setattr(
        refund_service,
        "send_sms",
        lambda **_: (_ for _ in ()).throw(refund_service.SemaphoreError("down")),
    )
    res = _client(db, _admin(db)).post(
        f"/admin/refunds/{txn.id}", json={"method": "paymongo", "reference": "re_1"}
    )
    assert res.status_code == 200, res.text
    db.expire_all()
    assert db.get(Transaction, txn.id).status == "refunded"


def test_non_admin_is_forbidden(db, merchant, sent):
    txn = _pending(db, merchant)
    buyer = db.get(Transaction, txn.id).user
    client = _client(db, buyer)
    assert client.get("/admin/refunds").status_code == 403
    res = client.post(
        f"/admin/refunds/{txn.id}", json={"method": "cash", "reference": "x"}
    )
    assert res.status_code == 403

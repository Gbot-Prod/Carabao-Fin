"""Refunds sent through the PayMongo Refunds API from /admin/refunds."""

import pytest

from app.models.admin_audit_log import AdminAuditLog
from app.models.transaction import Transaction
from app.services import paymongo, refund_service
from tests.test_admin_orders import _admin, _client
from tests.test_refunds import _pending


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


@pytest.fixture
def paymongo_calls(monkeypatch):
    """create_refund answers ``pending`` unless a test sets ``answer``."""
    calls: dict = {"create": [], "get": [], "answer": None, "status": "pending"}

    def create(**kw):
        calls["create"].append(kw)
        if isinstance(calls["answer"], Exception):
            raise calls["answer"]
        return {"id": "ref_1", "attributes": {"status": calls["status"]}}

    def get(refund_id):
        calls["get"].append(refund_id)
        return {"id": refund_id, "attributes": {"status": calls["status"]}}

    monkeypatch.setattr(paymongo, "create_refund", create)
    monkeypatch.setattr(paymongo, "get_refund", get)
    return calls


def _with_payment(db, merchant):
    txn = _pending(db, merchant)
    txn.paymongo_payment_id = "pay_abc"
    db.commit()
    return txn


def test_send_marks_processing_then_refresh_finishes_it(
    db, merchant, sent, paymongo_calls
):
    txn = _with_payment(db, merchant)
    client = _client(db, _admin(db))

    listed = client.get("/admin/refunds").json()
    assert listed[0]["can_send_paymongo"] is True

    res = client.post(f"/admin/refunds/{txn.id}/paymongo")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "refund_pending"
    assert body["paymongo_refund_status"] == "processing"
    assert body["can_send_paymongo"] is False
    call = paymongo_calls["create"][0]
    assert call["payment_id"] == "pay_abc"
    assert call["amount_centavos"] == 50_000
    assert call["metadata"]["transaction_id"] == str(txn.id)
    assert sent["email"] == []

    # Sending twice or recording a manual refund now would pay twice.
    assert client.post(f"/admin/refunds/{txn.id}/paymongo").status_code == 409
    manual = client.post(
        f"/admin/refunds/{txn.id}", json={"method": "gcash", "reference": "X"}
    )
    assert manual.status_code == 409
    assert len(paymongo_calls["create"]) == 1

    paymongo_calls["status"] = "succeeded"
    res = client.post(f"/admin/refunds/{txn.id}/refresh")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "refunded"
    db.expire_all()
    stored = db.get(Transaction, txn.id)
    assert stored.refund_method == "paymongo"
    assert stored.refund_reference == "ref_1"
    assert stored.paymongo_refund_status is None
    assert sent["email"][0]["reference"] == "ref_1"
    actions = {a for (a,) in db.query(AdminAuditLog.action)}
    assert {"transaction.refund_sent", "transaction.refund"} <= actions


def test_rejected_refund_can_be_sent_again(db, merchant, sent, paymongo_calls):
    txn = _with_payment(db, merchant)
    client = _client(db, _admin(db))
    paymongo_calls["answer"] = paymongo.RefundRejected("payment_not_refundable: no")

    res = client.post(f"/admin/refunds/{txn.id}/paymongo")
    assert res.status_code == 200, res.text
    assert res.json()["paymongo_refund_status"] == "failed"
    assert "payment_not_refundable" in res.json()["refund_failure_reason"]
    assert res.json()["can_send_paymongo"] is True

    paymongo_calls["answer"] = None
    paymongo_calls["status"] = "succeeded"
    res = client.post(f"/admin/refunds/{txn.id}/paymongo")
    assert res.json()["status"] == "refunded"
    assert len(sent["email"]) == 1


def test_no_answer_blocks_a_second_send(db, merchant, sent, paymongo_calls):
    txn = _with_payment(db, merchant)
    client = _client(db, _admin(db))
    paymongo_calls["answer"] = paymongo.RefundOutcomeUnknown("timeout")

    res = client.post(f"/admin/refunds/{txn.id}/paymongo")
    assert res.json()["paymongo_refund_status"] == "unknown"
    assert res.json()["can_send_paymongo"] is False
    assert client.post(f"/admin/refunds/{txn.id}/paymongo").status_code == 409
    # The admin checked the dashboard and records it by hand.
    manual = client.post(
        f"/admin/refunds/{txn.id}", json={"method": "paymongo", "reference": "ref_9"}
    )
    assert manual.status_code == 200, manual.text
    assert manual.json()["paymongo_refund_status"] is None


def test_payment_without_paymongo_id_is_manual_only(db, merchant, paymongo_calls):
    txn = _pending(db, merchant)
    client = _client(db, _admin(db))
    assert client.get("/admin/refunds").json()[0]["can_send_paymongo"] is False
    assert client.post(f"/admin/refunds/{txn.id}/paymongo").status_code == 409
    assert paymongo_calls["create"] == []


def test_webhook_finishes_a_sent_refund(db, merchant, sent, paymongo_calls):
    txn = _with_payment(db, merchant)
    _client(db, _admin(db)).post(f"/admin/refunds/{txn.id}/paymongo")

    refund_service.handle_refund_event(
        db,
        {
            "id": "ref_1",
            "type": "refund",
            "attributes": {"status": "succeeded", "payment_id": "pay_abc"},
        },
    )
    db.expire_all()
    stored = db.get(Transaction, txn.id)
    assert stored.status == "refunded"
    assert stored.refund_reference == "ref_1"
    assert len(sent["email"]) == 1
    # A repeat of the event changes nothing.
    refund_service.handle_refund_event(
        db, {"id": "ref_1", "type": "refund", "attributes": {"status": "succeeded"}}
    )
    assert len(sent["email"]) == 1


def test_webhook_settles_an_unknown_refund_by_metadata(
    db, merchant, sent, paymongo_calls
):
    txn = _with_payment(db, merchant)
    paymongo_calls["answer"] = paymongo.RefundOutcomeUnknown("timeout")
    _client(db, _admin(db)).post(f"/admin/refunds/{txn.id}/paymongo")

    # Metadata naming another payment is ignored.
    refund_service.handle_refund_event(
        db,
        {
            "id": "ref_x",
            "type": "refund",
            "attributes": {
                "status": "succeeded",
                "payment_id": "pay_other",
                "metadata": {"transaction_id": str(txn.id)},
            },
        },
    )
    db.expire_all()
    assert db.get(Transaction, txn.id).status == "refund_pending"

    refund_service.handle_refund_event(
        db,
        {
            "id": "ref_7",
            "type": "refund",
            "attributes": {
                "status": "succeeded",
                "payment_id": "pay_abc",
                "metadata": {"transaction_id": str(txn.id)},
            },
        },
    )
    db.expire_all()
    stored = db.get(Transaction, txn.id)
    assert stored.status == "refunded"
    assert stored.paymongo_refund_id == "ref_7"


def test_webhook_failed_refund_can_be_resent(db, merchant, sent, paymongo_calls):
    txn = _with_payment(db, merchant)
    _client(db, _admin(db)).post(f"/admin/refunds/{txn.id}/paymongo")
    refund_service.handle_refund_event(
        db, {"id": "ref_1", "type": "refund", "attributes": {"status": "failed"}}
    )
    db.expire_all()
    stored = db.get(Transaction, txn.id)
    assert stored.status == "refund_pending"
    assert stored.paymongo_refund_status == "failed"
    assert refund_service.can_send_paymongo(stored)


def test_non_admin_cannot_send(db, merchant, paymongo_calls):
    txn = _with_payment(db, merchant)
    client = _client(db, db.get(Transaction, txn.id).user)
    assert client.post(f"/admin/refunds/{txn.id}/paymongo").status_code == 403
    assert client.post(f"/admin/refunds/{txn.id}/refresh").status_code == 403
    assert paymongo_calls["create"] == []

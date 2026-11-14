"""Merchant payouts are real PayMongo transfers.

A cash out becomes a batch; an admin sends it as one InstaPay transfer (fee
taken from the merchant's earnings); the batch is released or failed when
PayMongo reports back, and a failed batch is resent rather than rebuilt.
"""

import hashlib
import hmac
import json
import time
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import admin
from app.api.webhooks import paymongo as paymongo_webhook
from app.models.merchant_payout import MerchantPayoutInfo
from app.models.order import Order
from app.models.payout_batch import PayoutBatch
from app.models.statuses import OrderStatus, PayoutStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.services import paymongo, payout_service
from tests.test_merchant_orders import _merchant_client
from tests.test_reviews import buyer, db, merchant  # noqa: F401 - fixtures

GCASH = {
    "payout_type": "gcash",
    "ewallet_number": "+63 917 123 4567",
    "account_name": "Juan dela Cruz",
}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("PAYOUT_TRANSFER_FEE", "10")
    monkeypatch.setenv("PAYMONGO_USE_TEST", "false")
    monkeypatch.setenv("PAYMONGO_WEBHOOK_SECRET", "whsk_test")


@pytest.fixture
def transfers(monkeypatch):
    """Records create_transfer calls; set ``.result`` to a dict or exception."""

    class Recorder:
        calls: list[dict] = []
        result: object = {"id": "tr_1", "status": "pending"}

    recorder = Recorder()
    recorder.calls = []

    def fake_create_transfer(**kwargs):
        recorder.calls.append(kwargs)
        if isinstance(recorder.result, Exception):
            raise recorder.result
        return recorder.result

    monkeypatch.setattr(paymongo, "create_transfer", fake_create_transfer)
    return recorder


def _delivered_sale(db, merchant, buyer, merchant_amount=490):  # noqa: F811
    user, _ = buyer
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=OrderStatus.DELIVERED,
        delivered_at=datetime.now(UTC),
        total_price=500,
        items=[],
    )
    db.add(order)
    db.flush()
    db.add(
        Transaction(
            order_id=order.id,
            merchant_id=merchant.id,
            user_id=user.id,
            amount=500,
            platform_fee=500 - merchant_amount,
            merchant_amount=merchant_amount,
            status=TransactionStatus.PAID,
            paid_at=datetime.now(UTC),
        )
    )
    db.commit()


def _admin_client(db) -> TestClient:  # noqa: F811
    staff = User(email="admin@example.com", is_admin=True)
    db.add(staff)
    db.commit()
    app = FastAPI()
    app.include_router(admin.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: staff
    return TestClient(app)


def _requested_batch(db, merchant, buyer, **sale) -> dict:  # noqa: F811
    client = _merchant_client(db, merchant)
    assert client.put("/merchants/me/payout-info", json=GCASH).status_code == 200
    _delivered_sale(db, merchant, buyer, **sale)
    resp = client.post("/merchants/me/payouts/request")
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+63 917 123 4567", "09171234567"),
        ("639171234567", "09171234567"),
        ("9171234567", "09171234567"),
        ("0917-123-4567", "09171234567"),
    ],
)
def test_mobile_numbers_are_normalized(raw, expected):
    assert payout_service.normalize_mobile(raw) == expected


def test_bank_payout_info_stores_paymongo_bank(db, merchant, monkeypatch):  # noqa: F811
    monkeypatch.setattr(
        paymongo,
        "list_receiving_institutions",
        lambda _p="instapay": [{"code": "BNORPHMMXXX", "name": "BDO Unibank, Inc."}],
    )
    client = _merchant_client(db, merchant)
    bank = {
        "payout_type": "bank",
        "bank_code": "BNORPHMMXXX",
        "account_number": "001234567890",
        "account_name": "Juan dela Cruz",
    }

    resp = client.put("/merchants/me/payout-info", json=bank)
    assert resp.status_code == 200
    assert resp.json()["bank_name"] == "BDO Unibank, Inc."
    assert resp.json()["problem"] is None

    spaced = client.put(
        "/merchants/me/payout-info", json={**bank, "account_number": "0012-3456 7890"}
    )
    assert spaced.json()["account_number"] == "001234567890"
    card_like = client.put(
        "/merchants/me/payout-info", json={**bank, "account_number": "12AB"}
    )
    assert card_like.status_code == 422

    unknown = client.put(
        "/merchants/me/payout-info", json={**bank, "bank_code": "ZZZZPHMMXXX"}
    )
    assert unknown.status_code == 422


def test_legacy_free_text_bank_cannot_cash_out(db, merchant, buyer):  # noqa: F811
    db.add(
        MerchantPayoutInfo(
            merchant_id=merchant.id,
            payout_type="bank",
            bank_code="BDO",
            account_number="1",
            account_name="Juan",
        )
    )
    db.commit()
    _delivered_sale(db, merchant, buyer)
    client = _merchant_client(db, merchant)

    assert client.get("/merchants/me/payout-info").json()["problem"]
    resp = client.post("/merchants/me/payouts/request")
    assert resp.status_code == 400
    assert "bank" in resp.json()["detail"].lower()


def test_cash_out_shows_and_records_the_transfer_fee(db, merchant, buyer):  # noqa: F811
    client = _merchant_client(db, merchant)
    client.put("/merchants/me/payout-info", json=GCASH)
    _delivered_sale(db, merchant, buyer, merchant_amount=490)

    available = client.get("/merchants/me/payouts/available").json()
    assert available == {
        "transaction_count": 1,
        "gross_amount": 490,
        "transfer_fee": 10,
        "net_amount": 480,
    }

    batch = client.post("/merchants/me/payouts/request").json()
    assert (batch["gross_amount"], batch["transfer_fee"], batch["net_amount"]) == (
        490,
        10,
        480,
    )


def test_cash_out_must_cover_the_fee(db, merchant, buyer):  # noqa: F811
    client = _merchant_client(db, merchant)
    client.put("/merchants/me/payout-info", json=GCASH)
    _delivered_sale(db, merchant, buyer, merchant_amount=10)

    resp = client.post("/merchants/me/payouts/request")
    assert resp.status_code == 400


def test_admin_sees_destination_before_sending(db, merchant, buyer):  # noqa: F811
    _requested_batch(db, merchant, buyer)
    rows = _admin_client(db).get("/admin/batches").json()

    assert rows[0]["merchant_name"] == "Dela Cruz Farm"
    assert rows[0]["destination"] == {
        "type": "gcash",
        "institution": "GCash",
        "name": "Juan dela Cruz",
        "number": "09171234567",
        "provider": "pesonet",
        "problem": None,
    }


def test_send_makes_one_transfer_of_net_amount(db, merchant, buyer, transfers):  # noqa: F811
    batch = _requested_batch(db, merchant, buyer, merchant_amount=490)
    client = _admin_client(db)

    resp = client.patch(f"/admin/batches/{batch['id']}/release")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == PayoutStatus.PROCESSING
    assert body["paymongo_transfer_id"] == "tr_1"
    assert body["net_amount"] == 480
    assert body["transfer_provider"] == "pesonet"
    assert transfers.calls == [
        {
            "amount_centavos": 48000,
            "destination": {
                "number": "09171234567",
                "name": "Juan dela Cruz",
                "bic": "GXCHPHM2XXX",
            },
            # GCash refuses InstaPay from PayMongo wallets (AC06).
            "provider": "pesonet",
            "reference_number": f"CARABAO-PAYOUT-{batch['id']}-1",
            "description": f"Carabao payout #{batch['id']}",
            "metadata": {"payout_batch_id": str(batch["id"])},
        }
    ]

    # A second click while the transfer is in flight must not send again.
    again = client.patch(f"/admin/batches/{batch['id']}/release")
    assert again.status_code == 409
    assert len(transfers.calls) == 1


def test_rejected_transfer_fails_and_can_be_resent(db, merchant, buyer, transfers):  # noqa: F811
    batch = _requested_batch(db, merchant, buyer)
    client = _admin_client(db)

    transfers.result = paymongo.TransferRejected("insufficient_wallet_balance")
    failed = client.patch(f"/admin/batches/{batch['id']}/release").json()
    assert failed["status"] == PayoutStatus.FAILED
    assert "insufficient_wallet_balance" in failed["failure_reason"]

    # The failed batch keeps its transactions: no duplicate batch for them.
    resp = _merchant_client(db, merchant).post("/merchants/me/payouts/request")
    assert resp.status_code == 400

    transfers.result = {"id": "tr_2", "status": "pending"}
    resent = client.patch(f"/admin/batches/{batch['id']}/release").json()
    assert resent["status"] == PayoutStatus.PROCESSING
    assert resent["attempts"] == 2
    assert resent["failure_reason"] is None
    assert transfers.calls[-1]["reference_number"].endswith("-2")


def test_unknown_outcome_stays_processing(db, merchant, buyer, transfers):  # noqa: F811
    batch = _requested_batch(db, merchant, buyer)
    transfers.result = paymongo.TransferOutcomeUnknown("timeout")

    body = _admin_client(db).patch(f"/admin/batches/{batch['id']}/release").json()

    assert body["status"] == PayoutStatus.PROCESSING
    assert "do not resend" in body["failure_reason"]


def _webhook_client(db) -> TestClient:  # noqa: F811
    app = FastAPI()
    app.include_router(paymongo_webhook.router)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _post_event(client, event_type: str, transfer: dict):
    body = json.dumps(
        {
            "data": {
                "id": "evt_1",
                "type": "event",
                "attributes": {"type": event_type, "data": transfer},
            }
        }
    ).encode()
    ts = str(int(time.time()))
    sig = hmac.new(b"whsk_test", f"{ts}.".encode() + body, hashlib.sha256)
    return client.post(
        "/webhooks/paymongo",
        content=body,
        headers={
            "Paymongo-Signature": f"t={ts},te=,li={sig.hexdigest()}",
            "Content-Type": "application/json",
        },
    )


def test_webhook_releases_batch_by_reference(db, merchant, buyer, transfers):  # noqa: F811
    batch = _requested_batch(db, merchant, buyer)
    transfers.result = paymongo.TransferOutcomeUnknown("timeout")  # no transfer id
    _admin_client(db).patch(f"/admin/batches/{batch['id']}/release")

    resp = _post_event(
        _webhook_client(db),
        "transfer.outward.successful",
        {
            "id": "tr_9",
            "type": "wallet_transaction",
            "attributes": {
                "transfer_id": "tr_9",
                "status": "succeeded",
                "reference_number": f"CARABAO-PAYOUT-{batch['id']}-1",
                "provider_reference_number": "INSTAPAY123",
            },
        },
    )

    assert resp.status_code == 200
    stored = db.get(PayoutBatch, batch["id"])
    db.refresh(stored)
    assert stored.status == PayoutStatus.RELEASED
    assert stored.released_at is not None
    assert stored.paymongo_transfer_id == "tr_9"
    assert stored.provider_reference == "INSTAPAY123"


def test_webhook_failure_marks_batch_failed(db, merchant, buyer, transfers):  # noqa: F811
    batch = _requested_batch(db, merchant, buyer)
    _admin_client(db).patch(f"/admin/batches/{batch['id']}/release")

    _post_event(
        _webhook_client(db),
        "transfer.outward.failed",
        {
            "id": "tr_1",
            "type": "wallet_transaction",
            "attributes": {
                "transfer_id": "tr_1",
                "status": "failed",
                "provider_error": "Account does not exist",
                "provider_error_code": "BENEFICIARY_ACCOUNT_INVALID",
            },
        },
    )

    stored = db.get(PayoutBatch, batch["id"])
    db.refresh(stored)
    assert stored.status == PayoutStatus.FAILED
    assert stored.failure_reason.startswith("BENEFICIARY_ACCOUNT_INVALID")


def test_refresh_reads_transfer_status(db, merchant, buyer, transfers, monkeypatch):  # noqa: F811
    batch = _requested_batch(db, merchant, buyer)
    client = _admin_client(db)
    client.patch(f"/admin/batches/{batch['id']}/release")
    monkeypatch.setattr(
        paymongo,
        "get_transfer",
        lambda _id: {"id": "tr_1", "status": "succeeded"},
    )

    body = client.post(f"/admin/batches/{batch['id']}/refresh").json()

    assert body["status"] == PayoutStatus.RELEASED


def test_refresh_records_why_the_bank_refused(
    db,  # noqa: F811
    merchant,  # noqa: F811
    buyer,  # noqa: F811
    transfers,
    monkeypatch,
):
    batch = _requested_batch(db, merchant, buyer)
    client = _admin_client(db)
    client.patch(f"/admin/batches/{batch['id']}/release")
    # Shape of a real failed transfer from GET /v2/transfers/{id}.
    monkeypatch.setattr(
        paymongo,
        "get_transfer",
        lambda _id: {
            "id": "tr_1",
            "status": "failed",
            "provider_error_code": "AC06",
            "provider_error_message": "BlockedAccount",
        },
    )

    body = client.post(f"/admin/batches/{batch['id']}/refresh").json()

    assert body["status"] == PayoutStatus.FAILED
    assert body["failure_reason"] == "AC06 - BlockedAccount"


def test_maya_and_banks_go_by_instapay(db, merchant, buyer, transfers, monkeypatch):  # noqa: F811
    monkeypatch.setattr(
        paymongo,
        "list_receiving_institutions",
        lambda _p="instapay": [{"code": "BNORPHMMXXX", "name": "BDO Unibank, Inc."}],
    )
    client = _merchant_client(db, merchant)
    client.put("/merchants/me/payout-info", json={**GCASH, "payout_type": "maya"})
    _delivered_sale(db, merchant, buyer)
    maya = client.post("/merchants/me/payouts/request").json()
    admin_client = _admin_client(db)
    admin_client.patch(f"/admin/batches/{maya['id']}/release")

    assert transfers.calls[-1]["provider"] == "instapay"
    assert transfers.calls[-1]["destination"]["bic"] == "PAPHPHM1XXX"

    client.put(
        "/merchants/me/payout-info",
        json={
            "payout_type": "bank",
            "bank_code": "BNORPHMMXXX",
            "account_number": "001234567890",
            "account_name": "Juan dela Cruz",
        },
    )
    batch = db.get(PayoutBatch, maya["id"])
    batch.status = PayoutStatus.FAILED
    db.commit()
    admin_client.patch(f"/admin/batches/{maya['id']}/release")

    assert transfers.calls[-1]["provider"] == "instapay"
    assert transfers.calls[-1]["destination"]["bic"] == "BNORPHMMXXX"


def test_instapay_cap_blocks_large_bank_payouts(db, merchant, buyer, transfers):  # noqa: F811
    client = _merchant_client(db, merchant)
    client.put("/merchants/me/payout-info", json={**GCASH, "payout_type": "maya"})
    _delivered_sale(db, merchant, buyer, merchant_amount=60_000)
    batch = client.post("/merchants/me/payouts/request").json()

    resp = _admin_client(db).patch(f"/admin/batches/{batch['id']}/release")

    assert resp.status_code == 400
    assert "InstaPay" in resp.json()["detail"]
    assert transfers.calls == []
    assert db.get(PayoutBatch, batch["id"]).status == PayoutStatus.PENDING


def test_admin_sees_wallet_balance_in_pesos(db, monkeypatch):  # noqa: F811
    monkeypatch.setattr(
        paymongo, "get_wallet_balance", lambda: {"available": 6861, "pending": 0}
    )
    assert _admin_client(db).get("/admin/wallet").json() == {
        "available": 68.61,
        "pending": 0.0,
    }


def test_wallet_balance_error_is_a_502(db, monkeypatch):  # noqa: F811
    def boom():
        raise RuntimeError("down")

    monkeypatch.setattr(paymongo, "get_wallet_balance", boom)
    assert _admin_client(db).get("/admin/wallet").status_code == 502

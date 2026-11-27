"""Penny-drop destination verification lifecycle and payout gates."""

from datetime import UTC, datetime, timedelta

from app.models.merchant_payout import MerchantPayoutInfo, PayoutVerificationAttempt
from app.models.statuses import (
    PayoutDestinationVerificationStatus,
    PayoutVerificationAttemptStatus,
)
from app.services import paymongo, payout_verification
from tests.payout_codes import save_payout_info
from tests.test_merchant_orders import _merchant_client
from tests.test_payouts import (  # noqa: F401 - fixtures
    GCASH,
    _admin_client,
    _delivered_sale,
    _env,
    transfers,
)

MAYA = {**GCASH, "payout_type": "maya", "ewallet_number": "09998887777"}


def test_unverified_destination_cannot_request_or_send_payout(db, merchant, buyer):  # noqa: F811
    client = _merchant_client(db, merchant)
    resp = save_payout_info(client, GCASH)
    assert resp.status_code == 200
    assert resp.json()["verification_status"] == "unverified"

    _delivered_sale(db, merchant, buyer)
    req = client.post("/merchants/me/payouts/request")
    assert req.status_code == 403
    assert "verify" in req.json()["detail"].lower()


def test_penny_drop_full_flow_and_amount_confirmation(db, merchant, buyer, transfers):  # noqa: F811
    client = _merchant_client(db, merchant)
    assert save_payout_info(client, GCASH).status_code == 200

    started = client.post("/merchants/me/payout-info/verify")
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["status"] == "sent"
    assert body["attempts_remaining"] == 5
    assert body["monthly_attempts_used"] == 1
    assert body["monthly_attempts_limit"] == 3

    assert len(transfers.calls) == 1
    sent_centavos = transfers.calls[0]["amount_centavos"]
    assert 1001 <= sent_centavos <= 1099
    assert transfers.calls[0]["destination"]["number"] == "09171234567"

    # Duplicate start while an active transfer is in flight is blocked.
    dup = client.post("/merchants/me/payout-info/verify")
    assert dup.status_code == 409

    # Wrong amount decrements attempts_remaining.
    wrong_centavos = sent_centavos + 1 if sent_centavos < 1099 else sent_centavos - 1
    bad = client.post(
        "/merchants/me/payout-info/verify/confirm",
        json={"amount_pesos": wrong_centavos / 100},
    )
    assert bad.status_code == 400
    assert "4 attempt(s) remaining" in bad.json()["detail"]

    # Exact amount marks the destination verified and unblocks payout requests.
    ok = client.post(
        "/merchants/me/payout-info/verify/confirm",
        json={"amount_pesos": sent_centavos / 100},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["verification_status"] == "verified"
    assert ok.json()["verification_method"] == "penny_drop"
    assert ok.json()["verified_at"] is not None

    _delivered_sale(db, merchant, buyer)
    batch = client.post("/merchants/me/payouts/request")
    assert batch.status_code == 200, batch.text


def test_changing_destination_resets_verification(db, merchant, transfers):  # noqa: F811
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    client.post("/merchants/me/payout-info/verify")
    sent_centavos = transfers.calls[-1]["amount_centavos"]
    assert (
        client.post(
            "/merchants/me/payout-info/verify/confirm",
            json={"amount_pesos": sent_centavos / 100},
        ).status_code
        == 200
    )

    changed = save_payout_info(client, MAYA)
    assert changed.status_code == 200
    assert changed.json()["verification_status"] == "unverified"
    assert changed.json()["verified_at"] is None


def test_monthly_penny_drop_limit_is_enforced(db, merchant, transfers):  # noqa: F811
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)

    for idx in range(3):
        resp = client.post("/merchants/me/payout-info/verify")
        assert resp.status_code == 200, resp.text
        # Expire the attempt so a new one can be requested, up to the 3/month cap.
        attempt = (
            db.query(PayoutVerificationAttempt)
            .order_by(PayoutVerificationAttempt.id.desc())
            .first()
        )
        attempt.status = PayoutVerificationAttemptStatus.EXPIRED
        db.commit()

    blocked = client.post("/merchants/me/payout-info/verify")
    assert blocked.status_code == 429
    assert "3 verification transfers" in blocked.json()["detail"]


def test_too_many_wrong_guesses_locks_attempt(db, merchant, transfers):  # noqa: F811
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    client.post("/merchants/me/payout-info/verify")
    sent_centavos = transfers.calls[-1]["amount_centavos"]
    wrong = sent_centavos + 1 if sent_centavos < 1099 else sent_centavos - 1

    for _ in range(5):
        resp = client.post(
            "/merchants/me/payout-info/verify/confirm",
            json={"amount_pesos": wrong / 100},
        )
        assert resp.status_code == 400

    info = (
        db.query(MerchantPayoutInfo)
        .filter(MerchantPayoutInfo.merchant_id == merchant.id)
        .first()
    )
    assert info.verification_status == PayoutDestinationVerificationStatus.FAILED


def test_webhook_updates_verification_attempt_without_touching_batches(
    db, merchant, transfers  # noqa: F811
):
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    client.post("/merchants/me/payout-info/verify")
    attempt = db.query(PayoutVerificationAttempt).one()

    handled = payout_verification.handle_verification_transfer_event(
        db,
        "transfer.outward.failed",
        {
            "id": attempt.paymongo_transfer_id,
            "attributes": {
                "transfer_id": attempt.paymongo_transfer_id,
                "reference_number": attempt.paymongo_reference,
                "status": "failed",
                "provider_error_code": "AC06",
                "provider_error_message": "Blocked account",
                "metadata": {"verification_attempt_id": str(attempt.id)},
            },
        },
    )
    assert handled is True
    db.refresh(attempt)
    assert attempt.status == PayoutVerificationAttemptStatus.FAILED
    assert "AC06" in attempt.failure_reason
    info = (
        db.query(MerchantPayoutInfo)
        .filter(MerchantPayoutInfo.merchant_id == merchant.id)
        .first()
    )
    assert info.verification_status == PayoutDestinationVerificationStatus.FAILED


def test_rejected_penny_drop_marks_info_failed(db, merchant, monkeypatch):  # noqa: F811
    def reject(**_kwargs):
        raise paymongo.TransferRejected("Invalid account", codes="AC01")

    monkeypatch.setattr(paymongo, "create_transfer", reject)
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)

    resp = client.post("/merchants/me/payout-info/verify")
    assert resp.status_code == 400
    assert "Invalid account" in resp.json()["detail"]

    info = (
        db.query(MerchantPayoutInfo)
        .filter(MerchantPayoutInfo.merchant_id == merchant.id)
        .first()
    )
    assert info.verification_status == PayoutDestinationVerificationStatus.FAILED


def test_expired_attempt_cannot_be_confirmed(db, merchant, transfers):  # noqa: F811
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    client.post("/merchants/me/payout-info/verify")
    attempt = db.query(PayoutVerificationAttempt).one()
    attempt.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()

    resp = client.post(
        "/merchants/me/payout-info/verify/confirm",
        json={"amount_pesos": attempt.amount_centavos / 100},
    )
    assert resp.status_code == 400
    assert "expired" in resp.json()["detail"].lower()

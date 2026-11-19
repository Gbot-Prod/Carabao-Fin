"""CF-0004: a payout goes where it was requested, and changing where payouts
go takes an SMS code, alerts the merchant and leaves an audit row."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.merchant_payout import PayoutDestinationChange
from app.models.otp import OtpCode
from app.models.payout_batch import PayoutBatch
from app.models.statuses import PayoutStatus
from app.services import rate_limit
from app.services.phone_verification import normalize_ph_mobile
from tests import payout_codes
from tests.better_auth import set_identity
from tests.payout_codes import last_code, save_payout_info
from tests.test_merchant_orders import _merchant_client
from tests.test_payouts import (  # noqa: F401 - fixtures
    GCASH,
    _admin_client,
    _delivered_sale,
    _env,
    transfers,
)

MAYA = {**GCASH, "payout_type": "maya", "ewallet_number": "09998887777"}


def test_saving_without_a_code_is_refused(db, merchant):  # noqa: F811
    client = _merchant_client(db, merchant)
    assert client.put("/merchants/me/payout-info", json=GCASH).status_code == 422
    resp = client.put("/merchants/me/payout-info", json={**GCASH, "code": "000000"})
    assert resp.status_code == 400
    assert db.query(PayoutDestinationChange).count() == 0


def test_code_only_saves_the_destination_it_was_sent_for(db, merchant, _payout_sms):  # noqa: F811
    client = _merchant_client(db, merchant)
    assert client.post("/merchants/me/payout-info/code", json=GCASH).status_code == 200
    # The code goes to the account's verified number and names the destination.
    assert "GCash ending 4567" in _payout_sms[-1]["message"]

    swapped = client.put(
        "/merchants/me/payout-info", json={**MAYA, "code": last_code()}
    )
    assert swapped.status_code == 400
    ok = client.put("/merchants/me/payout-info", json={**GCASH, "code": last_code()})
    assert ok.status_code == 200, ok.text


def test_payout_codes_count_against_the_per_user_sms_limit(db, merchant, _payout_sms):  # noqa: F811
    # The user's other SMS codes this hour (e.g. contact-number codes) used up
    # the shared count; the account number's own limit is untouched.
    for _ in range(rate_limit.IDENTIFIER_LIMITS["otp_send_user"].max_hits):
        rate_limit.enforce_identifier(db, "otp_send_user", str(merchant.user_id))
    sent_before = len(_payout_sms)

    blocked = _merchant_client(db, merchant).post("/merchants/me/payout-info/code", json=GCASH)
    assert blocked.status_code == 429
    assert blocked.json()["detail"].startswith("Too many codes requested")
    assert int(blocked.headers["Retry-After"]) > 60
    assert len(_payout_sms) == sent_before
    # The refused send freed its cooldown claim.
    assert db.query(OtpCode).count() == 0


def test_change_is_audited_and_alerts_old_contacts(db, merchant, _payout_sms):  # noqa: F811
    client = _merchant_client(db, merchant)
    assert save_payout_info(client, GCASH).status_code == 200
    first = db.query(PayoutDestinationChange).one()
    assert first.before is None and first.after["ewallet_number"] == "09171234567"

    _payout_sms.clear()
    assert save_payout_info(client, MAYA).status_code == 200
    change = (
        db.query(PayoutDestinationChange)
        .order_by(PayoutDestinationChange.id.desc())
        .first()
    )
    assert change.before["payout_type"] == "gcash"
    assert change.after["payout_type"] == "maya"
    assert change.user_id == merchant.user_id

    alerts = [m for m in _payout_sms if m["code"] is None]
    assert alerts, "the merchant's numbers on file get an alert"
    assert all(
        "changed from GCash ending 4567 to Maya ending 7777" in m["message"]
        for m in alerts
    )


def test_requested_payout_keeps_its_destination(db, merchant, buyer, transfers):  # noqa: F811
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    _delivered_sale(db, merchant, buyer)
    batch = client.post("/merchants/me/payouts/request").json()
    assert batch["destination_number"] == "09171234567"

    # A later (even code-confirmed) change does not redirect the pending payout.
    assert save_payout_info(client, MAYA).status_code == 200
    admin = _admin_client(db)
    assert admin.get("/admin/batches").json()[0]["destination"]["number"] == (
        "09171234567"
    )
    admin.patch(f"/admin/batches/{batch['id']}/release")
    assert transfers.calls[-1]["destination"]["number"] == "09171234567"


def test_failed_payout_moves_to_the_confirmed_destination(
    db, merchant, buyer, transfers
):  # noqa: F811
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    _delivered_sale(db, merchant, buyer)
    batch_id = client.post("/merchants/me/payouts/request").json()["id"]
    row = db.get(PayoutBatch, batch_id)
    row.status = PayoutStatus.FAILED
    db.commit()

    save_payout_info(client, MAYA)
    _admin_client(db).patch(f"/admin/batches/{batch_id}/release")
    assert transfers.calls[-1]["destination"]["number"] == "09998887777"


def test_batch_without_saved_destination_is_not_sent(db, merchant, buyer, transfers):  # noqa: F811
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    _delivered_sale(db, merchant, buyer)
    batch_id = client.post("/merchants/me/payouts/request").json()["id"]
    row = db.get(PayoutBatch, batch_id)
    row.destination_number = None
    db.commit()

    resp = _admin_client(db).patch(f"/admin/batches/{batch_id}/release")
    assert resp.status_code == 409
    assert transfers.calls == []


# --- CF-0019: the alert also reaches the email and recently replaced numbers --


def _alerted_numbers(sent) -> set[str]:
    return {m["number"] for m in sent if m["code"] is None}


def test_alert_goes_to_the_verified_email(db, merchant, _payout_sms):  # noqa: F811
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    assert payout_codes.EMAILS == [], "the first destination is not a change"
    assert save_payout_info(client, MAYA).status_code == 200
    assert payout_codes.EMAILS == [
        {
            "to": "farmer@example.com",
            "old": "GCash ending 4567",
            "new": "Maya ending 7777",
        }
    ]


def test_no_alert_email_to_an_unverified_address(db, merchant, _payout_sms):  # noqa: F811
    set_identity(db, merchant.user, emailVerified=False)
    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    assert save_payout_info(client, MAYA).status_code == 200
    assert payout_codes.EMAILS == []


@pytest.mark.parametrize(("days_ago", "alerted"), [(1, True), (2.9, True), (4, False)])
def test_alert_reaches_numbers_replaced_in_the_last_3_days(
    db,  # noqa: F811
    merchant,  # noqa: F811
    _payout_sms,
    days_ago,
    alerted,
):
    changed_at = datetime.now(UTC) - timedelta(days=days_ago)
    # BetterAuth stores a naive UTC time on SQLite.
    set_identity(
        db,
        merchant.user,
        previousPhoneNumber="+639181110000",
        phoneNumberChangedAt=changed_at.replace(tzinfo=None),
    )
    merchant.previous_contact_number = "+639182220000"
    merchant.contact_number_changed_at = changed_at
    db.commit()

    client = _merchant_client(db, merchant)
    save_payout_info(client, GCASH)
    _payout_sms.clear()
    assert save_payout_info(client, MAYA).status_code == 200

    numbers = _alerted_numbers(_payout_sms)
    old = {"639181110000", "639182220000"}
    assert numbers & old == (old if alerted else set())
    # The current numbers always get it.
    assert normalize_ph_mobile(merchant.user.phone_number) in numbers


# --- CF-0024: PayMongo and the code check run before the row lock -----------


def test_row_lock_is_taken_after_the_code_check(db, merchant, monkeypatch):  # noqa: F811
    from app.api.routes import merchants as routes

    calls: list[str] = []
    # CF-0054: payout-info changes use the suspension-aware lookup.
    real_get = routes.get_editable_merchant
    real_check = routes.payout_otp.check_code

    def get_editable_merchant(db, user_id, *, for_update=False):
        calls.append("lock" if for_update else "read")
        return real_get(db, user_id, for_update=for_update)

    def check_code(*args, **kwargs):
        calls.append("code")
        return real_check(*args, **kwargs)

    monkeypatch.setattr(routes, "get_editable_merchant", get_editable_merchant)
    monkeypatch.setattr(routes.payout_otp, "check_code", check_code)

    client = _merchant_client(db, merchant)
    calls.clear()
    assert save_payout_info(client, GCASH).status_code == 200
    put = calls[calls.index("code") - 1 :]
    assert put == ["read", "code", "lock"]

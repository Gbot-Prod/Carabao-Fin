"""PATCH /merchants/me: input limits and the contact-number code (CF-0030),
and the merchant's own delivery fee (CF-0020)."""

from datetime import UTC, datetime, timedelta

import pytest

from app.services.phone_verification import sign_token
from tests.test_merchant_orders import _merchant_client

NEW_NUMBER = "+639185550000"


def _token(user_id, number="639185550000", purpose="merchant_phone"):
    return sign_token({"purpose": purpose, "user_id": user_id, "number": number}, 600)


@pytest.mark.parametrize(
    "body",
    [
        {"operating_hours": "Mon-Fri"},
        {"delivery_time": 2},
        {"rating": 5},
        {"merchant_name": "x" * 101},
        {"merchant_name": "ab"},
        {"address": "x" * 501},
        {"postal_code": "x" * 11},
        {"city": "x" * 101},
        {"region": None},
        {"address": None},
        {"available_days": ["Funday"]},
        {"available_days": ["Mon", "Mon"]},
        {"available_days": []},
        {"delivery_price": -1},
        {"delivery_price": 100_001},
        {"contact_number": "1" * 21},
    ],
)
def test_bad_updates_are_refused(db, merchant, body):  # noqa: F811
    resp = _merchant_client(db, merchant).patch("/merchants/me", json=body)
    assert resp.status_code == 422, resp.text


def test_merchant_sets_days_and_delivery_fee(db, merchant):  # noqa: F811
    resp = _merchant_client(db, merchant).patch(
        "/merchants/me",
        json={
            "available_days": ["Mon", "Sat"],
            "delivery_price": 80,
            "address": " Purok 9 ",
        },
    )
    assert resp.status_code == 200, resp.text
    db.refresh(merchant)
    assert merchant.available_days == ["Mon", "Sat"]
    assert merchant.delivery_price == 80
    assert merchant.address == "Purok 9"


def test_same_contact_number_needs_no_code(db, merchant):  # noqa: F811
    # On file as 639171234567; the form sends it formatted.
    resp = _merchant_client(db, merchant).patch(
        "/merchants/me", json={"contact_number": "+63 917 123 4567"}
    )
    assert resp.status_code == 200, resp.text
    db.refresh(merchant)
    assert merchant.previous_contact_number is None
    assert merchant.contact_number_changed_at is None


@pytest.mark.parametrize(
    "token",
    [
        None,
        "not-a-token",
        "other-user",
        "other-number",
        "other-purpose",
    ],
)
def test_new_contact_number_needs_its_code(db, merchant, token):  # noqa: F811
    tokens = {
        "other-user": _token(merchant.user_id + 1),
        "other-number": _token(merchant.user_id, number="639180000000"),
        "other-purpose": _token(merchant.user_id, purpose="something_else"),
    }
    body = {"contact_number": "0918 555 0000"}
    if token:
        body["phone_verification_token"] = tokens.get(token, token)
    resp = _merchant_client(db, merchant).patch("/merchants/me", json=body)
    assert resp.status_code == 400
    db.refresh(merchant)
    assert merchant.contact_number == "639171234567"


def test_new_contact_number_with_its_code_is_normalized_and_kept(db, merchant):  # noqa: F811
    resp = _merchant_client(db, merchant).patch(
        "/merchants/me",
        json={
            "contact_number": "0918 555 0000",
            "phone_verification_token": _token(merchant.user_id),
        },
    )
    assert resp.status_code == 200, resp.text
    db.refresh(merchant)
    assert merchant.contact_number == NEW_NUMBER
    assert merchant.previous_contact_number == "639171234567"
    assert merchant.contact_number_changed_at is not None


def _change_contact_number(db, merchant, number):  # noqa: F811
    resp = _merchant_client(db, merchant).patch(
        "/merchants/me",
        json={
            "contact_number": number,
            "phone_verification_token": _token(merchant.user_id, number=number),
        },
    )
    assert resp.status_code == 200, resp.text
    db.refresh(merchant)


def test_second_change_in_the_window_keeps_the_owners_number(db, merchant):  # noqa: F811
    # CF-0032: O -> A -> B inside 3 days. The previous number stays O.
    _change_contact_number(db, merchant, "639185550000")
    first_change = merchant.contact_number_changed_at
    _change_contact_number(db, merchant, "639186660000")
    assert merchant.contact_number == "+639186660000"
    assert merchant.previous_contact_number == "639171234567"
    assert merchant.contact_number_changed_at >= first_change


def test_change_after_the_window_replaces_the_previous_number(db, merchant):  # noqa: F811
    _change_contact_number(db, merchant, "639185550000")
    merchant.contact_number_changed_at = datetime.now(UTC) - timedelta(days=4)
    db.commit()
    _change_contact_number(db, merchant, "639186660000")
    assert merchant.previous_contact_number == "+639185550000"


def test_contact_number_must_be_a_ph_mobile(db, merchant):  # noqa: F811
    resp = _merchant_client(db, merchant).patch(
        "/merchants/me", json={"contact_number": "+1 555 0100"}
    )
    assert resp.status_code == 400

"""PR 3 input validation: CF-0008, CF-0009, CF-0010, CF-0011, CF-0012."""

import json

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.merchant_application import MerchantApplication
from app.models.order import Order
from app.models.produce import Produce
from app.schemas.cart import MAX_CART_ITEMS, MAX_ITEM_QUANTITY
from app.services.account_suspension import merchant_is_public
from tests.better_auth import make_user
from tests.test_audit_log import _client as _admin_client
from tests.test_audit_log import _staff
from tests.test_merchant_onboarding_phone import (
    PAYLOAD,
    onboarding_files,
    patch_uploads,
)
from tests.test_produce_pricing import _client, tomatoes  # noqa: F401 - fixture
from tests.test_reviews import _buyer

# --- CF-0008: the cart takes produce_id and quantity only -------------------


def test_cart_line_fields_come_from_the_listing(db, buyer, tomatoes):  # noqa: F811
    resp = _client(db, buyer[0]).put(
        "/carts/me", json={"items": [{"produce_id": tomatoes.id, "quantity": 4}]}
    )
    assert resp.status_code == 200, resp.text
    [line] = resp.json()["items"]
    assert line["produce"] == "Tomato"
    assert line["price"] == 50
    assert line["farm"] == "Dela Cruz Farm"
    assert line["id"] == str(tomatoes.id)


@pytest.mark.parametrize(
    "extra",
    [{"price": 1}, {"name": "Free stuff"}, {"image": "https://evil.example/x.png"}],
)
def test_cart_refuses_client_fields(db, buyer, tomatoes, extra):  # noqa: F811
    item = {"produce_id": tomatoes.id, "quantity": 4, **extra}
    resp = _client(db, buyer[0]).put("/carts/me", json={"items": [item]})
    assert resp.status_code == 422


@pytest.mark.parametrize("quantity", [0, -1, MAX_ITEM_QUANTITY + 1])
def test_cart_quantity_is_bounded(db, buyer, tomatoes, quantity):  # noqa: F811
    item = {"produce_id": tomatoes.id, "quantity": quantity}
    resp = _client(db, buyer[0]).put("/carts/me", json={"items": [item]})
    assert resp.status_code == 422


def test_cart_item_count_is_capped(db, buyer):  # noqa: F811
    items = [{"produce_id": i, "quantity": 1} for i in range(1, MAX_CART_ITEMS + 2)]
    resp = _client(db, buyer[0]).put("/carts/me", json={"items": items})
    assert resp.status_code == 422


def test_cart_refuses_duplicates_and_unknown_produce(db, buyer, tomatoes):  # noqa: F811
    client = _client(db, buyer[0])
    dup = [{"produce_id": tomatoes.id, "quantity": 3}] * 2
    assert client.put("/carts/me", json={"items": dup}).status_code == 422
    unknown = [{"produce_id": 999_999, "quantity": 3}]
    assert client.put("/carts/me", json={"items": unknown}).status_code == 400


def test_order_lines_ignore_junk_stored_in_the_cart(db, buyer, tomatoes):  # noqa: F811
    db.add(
        Cart(
            user_id=buyer[0].id,
            items=[
                {
                    "produce_id": tomatoes.id,
                    "quantity": 3,
                    "name": "Gold bars",
                    "image": "https://evil.example/x.png",
                    "note": "<script>",
                }
            ],
        )
    )
    db.commit()
    resp = _client(db, buyer[0]).post("/orders/me/place", json={})
    assert resp.status_code == 200, resp.text
    order = db.get(Order, resp.json()["order_id"])
    [line] = order.items
    assert line["name"] == "Tomato" and line["produce"] == "Tomato"
    assert line["image"] is None
    assert "note" not in line
    assert order.image is None


# --- CF-0012: PlaceOrderRequest ---------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"image": "https://evil.example/x.png"},
        {"service_fee": 0},
        {"payment_method": "gcash"},
        {"delivery_address": "x" * 501},
    ],
)
def test_place_order_refuses_extra_and_oversized_fields(db, buyer, body):  # noqa: F811
    resp = _client(db, buyer[0]).post("/orders/me/place", json=body)
    assert resp.status_code == 422


# --- CF-0009: CHECK constraints ---------------------------------------------


@pytest.mark.parametrize(
    "fields", [{"price": 0}, {"price": -5}, {"stock_quantity": -1}]
)
def test_produce_checks(db, merchant, fields):  # noqa: F811
    values = {"price": 10, "stock_quantity": 1, **fields}
    db.add(Produce(merchant_id=merchant.id, name="Bad", **values))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_order_total_check(db, merchant, buyer):  # noqa: F811
    db.add(
        Order(
            user_id=buyer[0].id,
            merchant_id=merchant.id,
            status="pending",
            total_price=-1,
            items=[],
        )
    )
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# --- CF-0028: one live merchant per TIN / RSBSA number ----------------------


def _second_merchant(db, **fields):  # noqa: F811
    owner = make_user(db, "second@example.com")
    db.flush()
    return Merchant(
        verification_status="verified",
        user_id=owner.id,
        merchant_name="Second Farm",
        region="Region III",
        province="Bulacan",
        address="Purok 2",
        postal_code="3000",
        available_days=["Mon"],
        operating_hours={},
        seller_type="individual_farmer",
        rsbsa_document_path="rsbsa/2.pdf",
        gov_id_type="Passport",
        gov_id_document_path="gov-id/x.pdf",
        **fields,
    )


@pytest.mark.parametrize(
    "field", [{"tin": "123-456-789"}, {"rsbsa_number": "03-14-01-001-00001"}]
)
def test_duplicate_identifier_is_refused(db, merchant, field):  # noqa: F811
    for key, value in field.items():
        setattr(merchant, key, value)
    db.commit()
    db.add(_second_merchant(db, **field))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_closed_merchant_frees_its_tin(db, merchant):  # noqa: F811
    from datetime import UTC, datetime

    merchant.tin = "123-456-789"
    merchant.deleted_at = datetime.now(UTC)
    db.commit()
    db.add(_second_merchant(db, tin="123-456-789"))
    db.commit()
    assert db.query(Merchant).filter(Merchant.tin_hmac.isnot(None)).count() == 2


# --- CF-0011: onboarding payload --------------------------------------------


@pytest.fixture
def applicant(db, monkeypatch):  # noqa: F811
    monkeypatch.setenv("AUTH_SYNC_SHARED_SECRET", "test-secret")
    patch_uploads(monkeypatch)
    user = make_user(db, "applicant@example.com", phone_number="+639171234567")
    db.commit()
    return user


def _submit(db, user, raw_payload=None, **overrides):  # noqa: F811
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.dependencies import get_current_user, get_db
    from app.api.routes import merchant_onboarding
    from app.core.errors import FieldErrors, field_errors_handler

    app = FastAPI()
    app.add_exception_handler(FieldErrors, field_errors_handler)
    app.include_router(merchant_onboarding.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    payload = {**PAYLOAD, "contact_email": user.email, **overrides}
    return TestClient(app).post(
        "/merchant-onboarding/me",
        data={
            "payload": raw_payload if raw_payload is not None else json.dumps(payload)
        },
        files=onboarding_files(),
    )


def test_onboarding_saves_the_normalized_number(db, applicant):  # noqa: F811
    resp = _submit(db, applicant, contact_number="0917 123 4567")
    assert resp.status_code == 200, resp.text
    application = db.query(MerchantApplication).one()
    assert application.contact_number == "+639171234567"


def test_onboarding_tin_is_optional(db, applicant):  # noqa: F811
    resp = _submit(db, applicant, tin="")
    assert resp.status_code == 200, resp.text
    application = db.query(MerchantApplication).one()
    assert application.tin is None and application.tin_hmac is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"delivery_price": 50},
        {"delivery_time": 2},
        {"is_admin": True},
        {"seller_type": "Pirate"},
        {"registration_type": "XYZ"},
        {"available_days": ["Funday"]},
        {"available_days": ["Mon", "Mon"]},
        {"merchant_name": "x" * 101},
        {"address": "x" * 501},
        {"tin": "123"},
    ],
)
def test_onboarding_refuses_bad_payloads(db, applicant, overrides):  # noqa: F811
    resp = _submit(db, applicant, **overrides)
    assert resp.status_code == 400
    assert db.query(MerchantApplication).count() == 0


@pytest.mark.parametrize(
    ("overrides", "field", "expected"),
    [
        ({"postal_code": ""}, "postal_code", "Postal code is required."),
        (
            {"merchant_name": "ab"},
            "merchant_name",
            "Merchant name must be at least 3 characters.",
        ),
        (
            {"tin": "123"},
            "tin",
            "TIN: must be 9 digits plus a 3-5 digit branch code, e.g. "
            "123-456-789-000 (use 000 if there is no branch).",
        ),
        (
            {"seller_type": "Pirate"},
            "seller_type",
            "Seller type is not one of the allowed options.",
        ),
        ({"lat": 999, "lng": 999}, "pin", None),
        (
            {"merchant_name": "x" * 51},
            "merchant_name",
            "Merchant name must be at most 50 characters.",
        ),
        (
            {"last_name": "x" * 81},
            "last_name",
            "Last name must be at most 80 characters.",
        ),
    ],
)
def test_onboarding_says_which_field_failed(db, applicant, overrides, field, expected):  # noqa: F811
    resp = _submit(db, applicant, **overrides)
    assert resp.status_code in (400, 422)
    body = resp.json()
    assert list(body["errors"]) == [field]
    if expected is not None:
        assert body["errors"][field] == expected
        assert body["detail"] == expected


def test_onboarding_accepts_names_at_their_limits(db, applicant):  # noqa: F811
    resp = _submit(db, applicant, merchant_name="x" * 50, last_name="y" * 80)
    assert resp.status_code == 200, resp.text


def test_onboarding_lists_every_failing_field(db, applicant):  # noqa: F811
    resp = _submit(db, applicant, postal_code="", merchant_name="ab")
    assert resp.status_code == 400
    assert set(resp.json()["errors"]) == {"postal_code", "merchant_name"}


def test_onboarding_refuses_deeply_nested_json(db, applicant):  # noqa: F811
    # json.loads raises RecursionError here, not ValueError: still a clean 400.
    resp = _submit(db, applicant, raw_payload="[" * 100_000 + "]" * 100_000)
    assert resp.status_code == 400
    assert resp.json()["detail"] == "Invalid onboarding payload"


# --- CF-0010: application status transitions --------------------------------


def _application(db, user, status):  # noqa: F811
    application = MerchantApplication(
        user_id=user.id,
        status=status,
        merchant_name="Applicant Farm",
        legal_business_name="Applicant Farm",
        barangay="Santo Rosario",
        seller_type="individual_farmer",
        contact_email="applicant@example.com",
        contact_number="+639170000001",
        rsbsa_document_path="rsbsa/3.pdf",
        gov_id_type="Passport",
        gov_id_document_path="gov-id/x.pdf",
        region="Region III",
        province="Bulacan",
        city="Malolos",
        address="Purok 4",
        postal_code="3000",
        available_days=["Mon"],
    )
    db.add(application)
    db.commit()
    return application


def _review(db, application, status, note=None):  # noqa: F811
    staff = _staff(db)
    return _admin_client(db, staff).patch(
        f"/admin/merchant-applications/{application.id}",
        json={"status": status, "admin_note": note},
    )


@pytest.mark.parametrize(
    "start,target",
    [
        ("rejected", "approved"),
        ("rejected", "suspended"),
        ("clarification", "approved"),
        ("approved", "rejected"),
        ("approved", "approved"),
        ("submitted", "suspended"),
        ("suspended", "approved"),
    ],
)
def test_invalid_moves_are_409(db, start, target):  # noqa: F811
    user, _ = _buyer(db, email="applicant@example.com")
    application = _application(db, user, start)
    assert _review(db, application, target).status_code == 409
    db.refresh(application)
    assert application.status == start


def test_submitted_is_not_a_review_choice(db):  # noqa: F811
    user, _ = _buyer(db, email="applicant@example.com")
    application = _application(db, user, "rejected")
    assert _review(db, application, "submitted").status_code == 422


def test_admin_note_is_capped(db):  # noqa: F811
    user, _ = _buyer(db, email="applicant@example.com")
    application = _application(db, user, "submitted")
    assert _review(db, application, "rejected", "x" * 2001).status_code == 422


def test_approve_then_suspend_deactivates_the_merchant(db):  # noqa: F811
    user, _ = _buyer(db, email="applicant@example.com")
    application = _application(db, user, "submitted")
    assert _review(db, application, "approved").status_code == 200
    shop = db.query(Merchant).filter(Merchant.user_id == user.id).one()
    assert shop.suspended_at is None

    assert _review(db, application, "suspended", "Fake listings").status_code == 200
    db.refresh(shop)
    assert shop.suspended_at is not None
    assert db.query(Merchant).filter(merchant_is_public()).count() == 0


@pytest.mark.parametrize(
    "status,code",
    [("rejected", 200), ("clarification", 200), ("submitted", 409), ("suspended", 409)],
)
def test_resubmit_only_from_rejected_or_clarification(
    db, applicant, status, code  # noqa: F811
):
    _application(db, applicant, status)
    resp = _submit(db, applicant)
    assert resp.status_code == code, resp.text
    if code == 200:
        assert resp.json()["status"] == "submitted"

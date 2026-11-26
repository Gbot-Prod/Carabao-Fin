"""The selling gate: only a verified merchant sells (merchant_verification.py).

Unverified merchants keep the Merchant Centre: they edit the shop draft, add
produce (private), set up payout details. Publishing, public produce, cart and
checkout and payout requests are refused or empty until
verified. A suspension takes the shop offline; placed orders still complete.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes.router import router as api_router
from app.core.errors import FieldErrors, field_errors_handler
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.models.saved_produce import SavedProduce
from app.models.statuses import OrderStatus
from app.models.user import User
from app.services.merchant_verification import (
    merchant_can_request_payout,
    merchant_can_sell,
)
from tests.checkout_helpers import ADDRESS, _cart
from tests.payout_codes import save_payout_info

UNVERIFIED = ("setup", "under_review", "needs_changes", "suspended")
GCASH = {
    "payout_type": "gcash",
    "ewallet_number": "+63 917 123 4567",
    "account_name": "Juan dela Cruz",
}


def _client(db: Session, user: User | None) -> TestClient:
    app = FastAPI()
    app.add_exception_handler(FieldErrors, field_errors_handler)
    app.include_router(api_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _owner(db: Session, merchant: Merchant) -> TestClient:
    return _client(db, db.get(User, merchant.user_id))


def _set(db: Session, merchant: Merchant, status: str) -> None:
    merchant.verification_status = status
    merchant.suspended_at = datetime.now(UTC) if status == "suspended" else None
    db.commit()


def _listing(db: Session, merchant: Merchant, name: str = "Talong") -> Produce:
    today = date.today()
    produce = Produce(
        merchant_id=merchant.id,
        name=name,
        category="Vegetables",
        price=50,
        stock_quantity=20,
        harvest_date=today - timedelta(days=1),
        best_before=today + timedelta(days=10),
    )
    db.add(produce)
    db.commit()
    return produce


def test_the_helpers() -> None:
    class M:
        deleted_at = None
        suspended_at = None
        verification_status = "verified"

    assert merchant_can_sell(M())
    for status in UNVERIFIED:
        m = M()
        m.verification_status = status
        assert not merchant_can_sell(m)
    m = M()
    m.verification_status = "suspended"
    # A suspended shop is still paid what it already earned (CF-0054).
    assert merchant_can_request_payout(m)
    m.verification_status = "under_review"
    assert not merchant_can_request_payout(m)


@pytest.mark.parametrize("status", ["setup", "under_review", "needs_changes"])
def test_publish_needs_verification(db: Session, merchant: Any, status: str) -> None:
    merchant.shop_page.published_at = None
    _set(db, merchant, status)
    owner = _owner(db, merchant)

    res = owner.post("/merchants/me/shoppage/publish")
    assert res.status_code == 403
    assert "once Carabao approves your documents" in res.json()["detail"]
    # Drafting stays allowed.
    res = owner.patch("/merchants/me/shoppage", json={"description": "Fresh"})
    assert res.status_code == 200, res.text

    _set(db, merchant, "verified")
    assert owner.post("/merchants/me/shoppage/publish").status_code == 200


@pytest.mark.parametrize("status", UNVERIFIED)
def test_public_produce_and_shop_hidden_until_verified(
    db: Session, merchant: Any, buyer: Any, status: str
) -> None:
    produce = _listing(db, merchant)
    user = buyer[0]
    db.add(SavedProduce(user_id=user.id, produce_id=produce.id))
    db.commit()
    public = _client(db, None)
    shopper = _client(db, user)
    slug = merchant.shop_page.slug

    def visible() -> dict[str, bool]:
        search = public.get("/produce/search").json()["items"]
        return {
            "search": any(i["id"] == produce.id for i in search),
            "farms": any(
                m["id"] == merchant.id for m in public.get("/merchants").json()
            ),
            "shop": public.get(f"/merchants/{merchant.id}/shoppage").status_code == 200,
            "slug": public.get(f"/shops/{slug}").status_code == 200,
            "saved": any(
                s["id"] == produce.id
                for s in shopper.get("/users/me/saved-produce").json()
            ),
        }

    assert all(visible().values()), visible()
    _set(db, merchant, status)
    assert not any(visible().values()), visible()
    _set(db, merchant, "verified")
    assert all(visible().values()), visible()


@pytest.mark.parametrize("status", UNVERIFIED)
def test_cart_and_checkout_refuse_an_unverified_farm(
    db: Session, merchant: Any, buyer: Any, status: str
) -> None:
    user = buyer[0]
    _cart(db, user, merchant)
    _set(db, merchant, status)
    client = _client(db, user)

    res = client.post("/orders/me/place", json={"delivery_address": ADDRESS})
    assert res.status_code == 400, res.text
    assert db.query(Order).count() == 0

    _set(db, merchant, "verified")
    res = client.post("/orders/me/place", json={"delivery_address": ADDRESS})
    assert res.status_code == 200, res.text


@pytest.mark.parametrize("status", ["setup", "under_review", "needs_changes"])
def test_payouts_need_verification_but_details_do_not(
    db: Session, merchant: Any, status: str
) -> None:
    _set(db, merchant, status)
    owner = _owner(db, merchant)
    # Payout details may be set up before verification.
    assert save_payout_info(owner, GCASH).status_code == 200
    res = owner.post("/merchants/me/payouts/request")
    assert res.status_code == 403
    assert "Payouts start once" in res.json()["detail"]


def test_suspended_merchant_may_still_request_earned_payouts(
    db: Session, merchant: Any
) -> None:
    owner = _owner(db, merchant)
    assert save_payout_info(owner, GCASH).status_code == 200
    _set(db, merchant, "suspended")
    res = owner.post("/merchants/me/payouts/request")
    # Not the verification refusal: there is simply nothing to cash out.
    assert res.status_code == 400, res.text


def test_unverified_merchant_adds_produce_privately(db: Session, merchant: Any) -> None:
    _set(db, merchant, "setup")
    owner = _owner(db, merchant)
    today = date.today()
    res = owner.post(
        "/produce/",
        json={
            "name": "Kamatis",
            "category": "Vegetables",
            "price": 40,
            "stock_quantity": 10,
            "harvest_date": (today - timedelta(days=1)).isoformat(),
            "best_before": (today + timedelta(days=7)).isoformat(),
        },
    )
    assert res.status_code == 200, res.text
    produce_id = res.json()["id"]
    res = owner.patch(f"/produce/{produce_id}", json={"price": 45})
    assert res.status_code == 200, res.text
    # The owner sees it on their dashboard; buyers do not.
    assert owner.get("/merchants/me/performance").json()["total_products"] == 1
    search = _client(db, None).get("/produce/search").json()["items"]
    assert all(item["id"] != produce_id for item in search)


def test_suspension_takes_the_shop_offline_but_orders_complete(
    db: Session, merchant: Any, buyer: Any
) -> None:
    produce = _listing(db, merchant)
    user = buyer[0]
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=OrderStatus.SHIPPED,
        shipped_at=datetime.now(UTC),
        total_price=100,
        items=[{"produce_id": produce.id, "quantity": 2}],
    )
    db.add(order)
    db.commit()

    _set(db, merchant, "suspended")
    public = _client(db, None)
    assert all(
        i["id"] != produce.id for i in public.get("/produce/search").json()["items"]
    )

    res = _client(db, user).post(f"/orders/me/{order.id}/confirm-received")
    assert res.status_code == 200, res.text
    db.refresh(order)
    assert order.status == OrderStatus.DELIVERED

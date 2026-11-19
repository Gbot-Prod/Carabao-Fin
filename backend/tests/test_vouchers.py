"""CF-0058: merchant voucher codes at checkout (B05 slice 1)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes import orders
from app.models.cart import Cart
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.produce import Produce
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.models.voucher import Voucher, VoucherRedemption
from app.services import vouchers
from app.services.receipts import build_receipt
from tests.shared_fixtures import _buyer
from tests.test_merchant_listings import _other_merchant

ADDRESS = "12 Mabini St, Malolos, Bulacan"


def _client(db: Session, user: User) -> TestClient:
    app = FastAPI()
    app.include_router(orders.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _voucher(db: Session, merchant: Merchant, **fields: Any) -> Voucher:
    data: dict[str, Any] = {"code": "SAVE10", "kind": "percent", "value": 10}
    data.update(fields)
    row = Voucher(merchant_id=merchant.id, **data)
    db.add(row)
    db.commit()
    return row


def _cart(
    db: Session, user: User, merchant: Merchant, price: int = 100, qty: int = 3
) -> Produce:
    produce = Produce(
        merchant_id=merchant.id, name="Talong", price=price, stock_quantity=50
    )
    db.add(produce)
    db.flush()
    cart: Any = db.query(Cart).filter(Cart.user_id == user.id).first()
    if cart is None:
        cart = Cart(user_id=user.id, items=[])
        db.add(cart)
    cart.items = [{"produce_id": produce.id, "quantity": qty}]
    db.commit()
    return produce


def _place(db: Session, user: User, code: str | None) -> Any:
    body: dict[str, Any] = {"delivery_address": ADDRESS}
    if code is not None:
        body["voucher_code"] = code
    return _client(db, user).post("/orders/me/place", json=body)


def test_percent_voucher_lowers_only_its_farms_order(
    db: Session, merchant: Any, buyer: Any
) -> None:
    """The discount comes off the owning farm's produce, not the delivery fee
    and not another farm's order; the use is recorded once."""
    user = buyer[0]
    rival: Any = _other_merchant(db)
    merchant.delivery_price = 40
    rival.delivery_price = 25
    mine = Produce(merchant_id=merchant.id, name="Talong", price=100, stock_quantity=9)
    theirs = Produce(merchant_id=rival.id, name="Mangga", price=50, stock_quantity=9)
    db.add_all([mine, theirs])
    db.flush()
    db.add(
        Cart(
            user_id=user.id,
            items=[
                {"produce_id": mine.id, "quantity": 3},
                {"produce_id": theirs.id, "quantity": 2},
            ],
        )
    )
    db.commit()
    _voucher(db, merchant, code="SAVE10", value=10)

    resp = _place(db, user, "  save10 ")

    assert resp.status_code == 200, resp.text
    placed = {o["merchant_id"]: o for o in resp.json()["orders"]}
    assert placed[merchant.id]["discount"] == 30
    assert placed[merchant.id]["voucher_code"] == "SAVE10"
    assert placed[merchant.id]["total_price"] == 300 + 40 - 30
    assert placed[rival.id]["discount"] == 0
    assert placed[rival.id]["total_price"] == 100 + 25
    stored: Any = db.query(Order).filter(Order.merchant_id == merchant.id).one()
    assert (stored.discount, stored.voucher_code) == (30, "SAVE10")
    uses: list[Any] = db.query(VoucherRedemption).all()
    assert [(u.order_id, u.discount, u.user_id) for u in uses] == [
        (stored.id, 30, user.id)
    ]


def test_discount_math() -> None:
    pct: Any = Voucher(kind="percent", value=15, max_discount=None)
    assert vouchers.compute_discount(pct, 333) == 49  # floor, never rounds up
    pct.max_discount = 20
    assert vouchers.compute_discount(pct, 333) == 20
    fixed = Voucher(kind="fixed", value=500)
    assert vouchers.compute_discount(fixed, 120) == 120  # never below zero
    assert vouchers.compute_discount(fixed, 900) == 500


@pytest.mark.parametrize(
    "fields, detail",
    [
        ({"active": False}, "not valid"),
        ({"expires_at": datetime.now(UTC) - timedelta(minutes=1)}, "expired"),
        ({"starts_at": datetime.now(UTC) + timedelta(days=1)}, "not active yet"),
        ({"min_subtotal": 500}, "at least ₱500"),
    ],
)
def test_unusable_voucher_places_nothing(
    db: Session, merchant: Any, buyer: Any, fields: dict[str, Any], detail: str
) -> None:
    user = buyer[0]
    produce: Any = _cart(db, user, merchant)
    _voucher(db, merchant, **fields)

    resp = _place(db, user, "SAVE10")

    assert resp.status_code == 400
    assert detail in resp.json()["detail"]
    # A real request's session is closed without a commit; the test shares one.
    db.rollback()
    assert db.query(Order).count() == 0
    assert db.query(VoucherRedemption).count() == 0
    held: Any = db.get(Produce, produce.id)
    assert held.stock_quantity == 50  # nothing held


def test_other_farms_code_and_bad_codes_look_the_same(
    db: Session, merchant: Any, buyer: Any
) -> None:
    """A code of a farm that is not in the cart gives the same answer as no
    such code, so buyers can't probe other farms' codes."""
    user = buyer[0]
    _cart(db, user, merchant)
    _voucher(db, _other_merchant(db), code="RIVAL50", kind="fixed", value=50)

    for code in ("RIVAL50", "NOPE99", "x", "bad code!", "A" * 40):
        resp = _place(db, user, code)
        assert resp.status_code == 400, code
        assert resp.json()["detail"] == vouchers.NOT_VALID
        db.rollback()
    assert db.query(Order).count() == 0


def test_usage_caps_and_cancelled_orders_give_the_use_back(
    db: Session, merchant: Any, buyer: Any
) -> None:
    first = buyer[0]
    second, _ = _buyer(db, "second@example.com")
    _voucher(db, merchant, usage_limit=1, per_user_limit=1)

    _cart(db, first, merchant)
    assert _place(db, first, "SAVE10").status_code == 200

    _cart(db, second, merchant)
    resp = _place(db, second, "SAVE10")
    assert resp.status_code == 400
    assert "fully used" in resp.json()["detail"]
    db.rollback()

    # The first buyer's unpaid order is cancelled: the use comes back.
    order: Any = db.query(Order).filter(Order.user_id == first.id).one()
    order.status = OrderStatus.CANCELLED
    db.commit()
    assert _place(db, second, "SAVE10").status_code == 200


def test_per_buyer_limit(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    _voucher(db, merchant, per_user_limit=1)
    _cart(db, user, merchant)
    assert _place(db, user, "SAVE10").status_code == 200

    _cart(db, user, merchant)
    resp = _place(db, user, "SAVE10")
    assert resp.status_code == 400
    assert "already used" in resp.json()["detail"]
    db.rollback()
    # Without the code the checkout still works.
    assert _place(db, user, None).status_code == 200


def test_empty_code_is_ignored(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    _cart(db, user, merchant)
    resp = _place(db, user, "   ")
    assert resp.status_code == 200
    assert resp.json()["orders"][0]["discount"] == 0


def test_receipt_shows_the_discount(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    merchant.delivery_price = 40
    _cart(db, user, merchant, price=100, qty=3)
    _voucher(db, merchant, code="LESS50", kind="fixed", value=50)
    assert _place(db, user, "LESS50").status_code == 200
    order: Any = db.query(Order).one()
    payment = Transaction(
        order_id=order.id,
        merchant_id=merchant.id,
        user_id=user.id,
        amount=order.total_price,
        platform_fee=6,
        merchant_amount=order.total_price - 6,
        status=TransactionStatus.PAID,
    )
    db.add(payment)
    db.commit()

    receipt = build_receipt(order, payment)

    assert (receipt.subtotal, receipt.delivery_fee, receipt.discount) == (300, 40, 50)
    assert receipt.total == 290
    assert receipt.voucher_code == "LESS50"
    assert receipt.subtotal + receipt.delivery_fee - receipt.discount == receipt.total


def test_claim_rejects_malformed_code_before_any_query(db: Session) -> None:
    with pytest.raises(HTTPException) as exc:
        vouchers.claim(db, "<script>", {1: 100}, user_id=1)
    assert exc.value.status_code == 400

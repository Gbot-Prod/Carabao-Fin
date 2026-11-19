"""CF-0064: buyers check a voucher code before placing the order (B05 slice 3)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.orm import Session

from app.api.routes._order_helpers import to_current_order_item
from app.models.order import Order
from app.models.produce import Produce
from app.models.voucher import VoucherRedemption
from app.services import rate_limit, vouchers
from tests.test_merchant_listings import _other_merchant
from tests.test_vouchers import _cart, _client, _place, _voucher

URL = "/orders/me/voucher-preview"


def test_preview_gives_the_discount_and_changes_nothing(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    merchant.delivery_price = 40
    produce: Any = _cart(db, user, merchant, price=100, qty=3)
    _voucher(db, merchant, code="SAVE10", value=10)

    res = _client(db, user).post(URL, json={"voucher_code": " save10 "})

    assert res.status_code == 200, res.text
    assert res.json() == {
        "code": "SAVE10",
        "merchant_id": merchant.id,
        "merchant_name": merchant.merchant_name,
        "discount": 30,  # 10 % of the produce, not of the delivery fee
    }
    db.expire_all()
    assert db.query(Order).count() == 0
    assert db.query(VoucherRedemption).count() == 0
    held: Any = db.get(Produce, produce.id)
    assert held.stock_quantity == 50

    # Placing the order then gives the same discount.
    placed = _place(db, user, "SAVE10").json()["orders"][0]
    assert placed["discount"] == 30


def test_preview_refuses_like_checkout(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    _cart(db, user, merchant)
    _voucher(db, _other_merchant(db), code="RIVAL50", kind="fixed", value=50)
    _voucher(db, merchant, code="BIG", kind="fixed", value=50, min_subtotal=1000)
    client = _client(db, user)

    other = client.post(URL, json={"voucher_code": "RIVAL50"})
    assert other.status_code == 400
    assert other.json()["detail"] == vouchers.NOT_VALID
    low = client.post(URL, json={"voucher_code": "BIG"})
    assert low.status_code == 400
    assert "at least ₱1,000" in low.json()["detail"]
    assert client.post(URL, json={"voucher_code": ""}).status_code == 422
    assert client.post(URL, json={"voucher_code": "X", "extra": 1}).status_code == 422


def test_preview_leaves_out_lines_checkout_would_refuse(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    produce: Any = _cart(db, user, merchant, price=100, qty=3)
    produce.hidden_at = datetime.now(UTC)
    db.commit()
    _voucher(db, merchant, code="SAVE10", value=10)

    res = _client(db, user).post(URL, json={"voucher_code": "SAVE10"})
    assert res.status_code == 400
    assert res.json()["detail"] == "Cart is empty"


def test_preview_is_rate_limited_per_buyer(
    db: Session, merchant: Any, buyer: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setitem(
        rate_limit.ACTION_LIMITS, "voucher_preview", rate_limit.Limit(2, 60)
    )
    user = buyer[0]
    _cart(db, user, merchant)
    client = _client(db, user)
    for _ in range(2):
        assert client.post(URL, json={"voucher_code": "GUESS1"}).status_code == 400
    res = client.post(URL, json={"voucher_code": "GUESS1"})
    assert res.status_code == 429
    assert int(res.headers["Retry-After"]) >= 1


def test_order_views_carry_the_discount(
    db: Session, merchant: Any, buyer: Any
) -> None:
    user = buyer[0]
    merchant.delivery_price = 40
    _cart(db, user, merchant, price=100, qty=3)
    _voucher(db, merchant, code="LESS50", kind="fixed", value=50)
    assert _place(db, user, "LESS50").status_code == 200
    order = db.query(Order).one()

    view = to_current_order_item(order)

    assert (view["discount"], view["voucher_code"]) == (50, "LESS50")
    assert (view["total_amount"], view["delivery_fee"]) == (290, 40)

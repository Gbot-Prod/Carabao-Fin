"""CF-0065 (B71, B72): the farm and admins see a voucher discount wherever
an order's total is shown, and the sales CSV adds up."""

from __future__ import annotations

from typing import Any, cast

from sqlalchemy.orm import Session

from app.api.routes.merchant_sales import EXPORT_COLUMNS
from app.models.user import User
from tests.shared_fixtures import _buyer
from tests.test_admin_orders import _admin
from tests.test_admin_orders import _client as _admin_client
from tests.test_admin_orders import _order as _admin_order
from tests.test_merchant_orders import _merchant_client, _scheduled_order
from tests.test_merchant_sales import _client as _sales_client
from tests.test_merchant_sales import _order as _sales_order
from tests.test_merchant_sales_export import _rows


def test_sales_csv_has_discount_and_adds_up(db: Session, merchant: Any) -> None:
    buyer = _buyer(db, "ana@example.com", "Ana Santos")
    order: Any = _sales_order(
        db,
        merchant,
        buyer,
        total=290,
        items=[{"produce_id": 1, "produce": "Talong", "quantity": 3, "price": 100}],
        days_ago=1,
    )
    order.delivery_fee = 40
    order.discount = 50
    order.voucher_code = "LESS50"
    plain: Any = _sales_order(
        db,
        merchant,
        buyer,
        total=140,
        items=[{"produce_id": 2, "produce": "Kamatis", "quantity": 1, "price": 100}],
        days_ago=2,
    )
    plain.delivery_fee = 40
    db.commit()
    owner = db.get(User, merchant.user_id)

    res = _sales_client(db, owner).get("/merchants/me/sales/export?days=30")

    assert res.status_code == 200, res.text
    rows = _rows(res.text)
    assert list(rows[0]) == EXPORT_COLUMNS
    assert {"order_discount", "order_voucher_code"} <= set(EXPORT_COLUMNS)
    by_id = {int(r["order_id"]): r for r in rows}
    voucher_row = by_id[order.id]
    assert (voucher_row["order_discount"], voucher_row["order_voucher_code"]) == (
        "50",
        "LESS50",
    )
    for r in rows:  # lines + delivery - discount = total (one line each here)
        total = int(r["line_total"]) + int(r["order_delivery_fee"]) - int(
            r["order_discount"]
        )
        assert total == int(r["order_total"]), r
    assert by_id[plain.id]["order_voucher_code"] == ""


def test_merchant_orders_tab_shows_the_voucher(db: Session, merchant: Any) -> None:
    buyer = _buyer(db, "b@example.com")
    make_order = cast(Any, _scheduled_order)  # untyped helper in an older test
    make_order(db, merchant, buyer, delivery_fee=40, discount=50, voucher_code="LESS50")

    [row] = _merchant_client(db, merchant).get("/merchants/me/orders").json()

    assert (row["delivery_fee"], row["discount"], row["voucher_code"]) == (
        40,
        50,
        "LESS50",
    )


def test_admin_order_list_and_detail_show_the_voucher(
    db: Session, merchant: Any
) -> None:
    buyer = _buyer(db, "c@example.com")
    order = _admin_order(db, merchant, buyer, discount=25, voucher_code="SAVE10")
    client = _admin_client(db, _admin(db))

    listed = client.get("/admin/orders").json()["items"][0]
    detail = client.get(f"/admin/orders/{order.id}").json()

    for view in (listed, detail):
        assert (view["discount"], view["voucher_code"]) == (25, "SAVE10")

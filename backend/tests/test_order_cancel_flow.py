"""CF-0045 / CF-0048 / CF-0051: cancel stock, buyer notice, admin cancel, sweep."""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.admin_audit_log import AdminAuditLog
from app.models.notification import Notification
from app.models.order import Order
from app.models.produce import Produce
from app.models.transaction import Transaction
from app.services import order_status
from tests.test_admin_orders import _admin, _client


def _setup(db, merchant, buyer, status="processing", paid_days_ago=1):
    user, _ = buyer
    produce = Produce(
        merchant_id=merchant.id, name="Talong", price=50, stock_quantity=10
    )
    db.add(produce)
    db.flush()
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=150,
        items=[{"produce_id": produce.id, "quantity": 3, "price": 50}],
        ordered_at=datetime.now(UTC) - timedelta(days=paid_days_ago),
    )
    db.add(order)
    db.flush()
    txn = Transaction(
        order_id=order.id,
        merchant_id=merchant.id,
        user_id=user.id,
        amount=150,
        platform_fee=10,
        merchant_amount=140,
        status="paid",
        paid_at=datetime.now(UTC) - timedelta(days=paid_days_ago),
    )
    db.add(txn)
    db.commit()
    return order, produce, txn


def _cancel_notices(db, user_id):
    return (
        db.query(Notification).filter_by(user_id=user_id, kind="order_cancelled").all()
    )


def test_cancel_processing_order_restores_stock(db, merchant, buyer):
    order, produce, txn = _setup(db, merchant, buyer, "processing")
    order_status.apply_merchant_transition(
        order, "cancelled", db, cancel_reason="Out of stock"
    )
    db.commit()
    db.refresh(produce)
    db.refresh(txn)
    assert produce.stock_quantity == 13
    assert txn.status == "refund_pending"


@pytest.mark.parametrize("status", ["shipped", "out_for_delivery"])
def test_cancel_after_shipping_does_not_restore_stock(db, merchant, buyer, status):
    order, produce, txn = _setup(db, merchant, buyer, status)
    order_status.apply_merchant_transition(
        order, "cancelled", db, cancel_reason="Out of stock"
    )
    db.commit()
    db.refresh(produce)
    db.refresh(txn)
    assert order.status == "cancelled"
    assert produce.stock_quantity == 10
    assert txn.status == "refund_pending"


def test_merchant_cancel_notifies_buyer(db, merchant, buyer):
    user, _ = buyer
    order, _, _ = _setup(db, merchant, buyer)
    order_status.apply_merchant_transition(
        order, "cancelled", db, cancel_reason="Out of stock"
    )
    db.commit()
    [notice] = _cancel_notices(db, user.id)
    ref = f"CB-{order.ordered_at.year}-{order.id:04d}"
    assert notice.title == f"Order {ref} was cancelled"
    assert notice.body.startswith(
        "The farm cancelled this order. Reason: Out of stock."
    )
    assert "refunded" in notice.body
    assert notice.link == f"/orders/{order.id}"
    assert order.cancel_reason == "Out of stock"


def test_merchant_cannot_cancel_without_reason(db, merchant, buyer):
    order, _, txn = _setup(db, merchant, buyer)
    with pytest.raises(order_status.InvalidTransition):
        order_status.apply_merchant_transition(order, "cancelled", db)
    assert order.status == "processing"


def test_merchant_cancel_text():
    text = order_status.merchant_cancel_text
    assert text("out_of_stock", None) == "Out of stock"
    assert (
        text("out_of_stock", "  rain hit the crop ")
        == "Out of stock: rain hit the crop"
    )
    assert text("other", "Truck broke down") == "Truck broke down"


def test_sweep_cancels_paid_orders_not_shipped_in_time(db, merchant, buyer):
    user, _ = buyer
    late, late_produce, late_txn = _setup(db, merchant, buyer, paid_days_ago=6)
    fresh, _, fresh_txn = _setup(db, merchant, buyer, paid_days_ago=2)
    shipped, _, _ = _setup(db, merchant, buyer, "shipped", paid_days_ago=9)

    assert order_status.cancel_unshipped_orders(db, 5) == 1
    db.commit()
    for row in (late, late_produce, late_txn, fresh, fresh_txn, shipped):
        db.refresh(row)

    assert late.status == "cancelled"
    assert late_txn.status == "refund_pending"
    assert late_produce.stock_quantity == 13
    assert fresh.status == "processing"
    assert fresh_txn.status == "paid"
    assert shipped.status == "shipped"
    assert len(_cancel_notices(db, user.id)) == 1
    assert len(_cancel_notices(db, merchant.user_id)) == 1


def test_admin_cancels_order_and_it_reaches_refund_queue(db, merchant, buyer):
    user, _ = buyer
    admin = _admin(db)
    order, _, txn = _setup(db, merchant, buyer, "shipped")
    client = _client(db, admin)

    res = client.post(
        f"/admin/orders/{order.id}/cancel", json={"reason": "Farm cannot deliver"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelled"
    assert res.json()["payment_status"] == "refund_pending"
    db.refresh(txn)
    assert txn.status == "refund_pending"
    [notice] = _cancel_notices(db, user.id)
    assert notice.body.startswith("Farm cannot deliver")
    entry = db.query(AdminAuditLog).filter_by(action="order.cancel").one()
    assert entry.target_id == order.id
    assert entry.before == {"status": "shipped"}

    refunds = client.get("/admin/refunds").json()
    assert [r["order_id"] for r in refunds] == [order.id]


def test_admin_cannot_cancel_closed_order(db, merchant, buyer):
    admin = _admin(db)
    order, _, _ = _setup(db, merchant, buyer, "delivered")
    res = _client(db, admin).post(
        f"/admin/orders/{order.id}/cancel", json={"reason": "Too late"}
    )
    assert res.status_code == 409


def test_admin_cancel_needs_a_reason(db, merchant, buyer):
    admin = _admin(db)
    order, _, _ = _setup(db, merchant, buyer)
    res = _client(db, admin).post(f"/admin/orders/{order.id}/cancel", json={})
    assert res.status_code == 422

"""One source of truth for order and payment status.

Payment status is derived from transactions, merchants only ever see and act
on paid orders, and the status columns reject values outside their enums.
"""

import pytest
from sqlalchemy.exc import StatementError

from app.models.order import Order
from app.models.statuses import OrderStatus, PaymentStatus, TransactionStatus
from app.models.transaction import Transaction
from app.services.order_status import payment_status
from tests.test_merchant_orders import _merchant_client
from tests.test_reviews import _client, buyer, db, merchant  # noqa: F401 - fixtures


def _order(db, merchant, buyer, status, *txn_statuses, total=500):
    user, history = buyer
    order = Order(
        order_history_id=history.id,
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=total,
        items=[],
    )
    db.add(order)
    db.flush()
    for txn_status in txn_statuses:
        db.add(
            Transaction(
                order_id=order.id,
                merchant_id=merchant.id,
                user_id=user.id,
                amount=total,
                platform_fee=10,
                merchant_amount=total - 10,
                status=txn_status,
            )
        )
    db.commit()
    db.refresh(order)
    return order


@pytest.mark.parametrize(
    ("order_status", "txn_statuses", "expected"),
    [
        (OrderStatus.PENDING, (), PaymentStatus.AWAITING_PAYMENT),
        (
            OrderStatus.PENDING,
            (TransactionStatus.PENDING,),
            PaymentStatus.AWAITING_PAYMENT,
        ),
        (
            OrderStatus.PROCESSING,
            (TransactionStatus.EXPIRED, TransactionStatus.PAID),
            PaymentStatus.PAID,
        ),
        (
            OrderStatus.CANCELLED,
            (TransactionStatus.REFUND_PENDING,),
            PaymentStatus.REFUND_PENDING,
        ),
        (
            OrderStatus.CANCELLED,
            (TransactionStatus.REFUNDED,),
            PaymentStatus.REFUNDED,
        ),
        (OrderStatus.CANCELLED, (TransactionStatus.EXPIRED,), PaymentStatus.UNPAID),
        # A second charge on a paid order is refunded; the order is still paid.
        (
            OrderStatus.PROCESSING,
            (TransactionStatus.PAID, TransactionStatus.REFUND_PENDING),
            PaymentStatus.PAID,
        ),
    ],
)
def test_payment_status_is_derived_from_transactions(
    db, merchant, buyer, order_status, txn_statuses, expected  # noqa: F811
):
    order = _order(db, merchant, buyer, order_status, *txn_statuses)
    assert payment_status(order) == expected


def test_merchant_cannot_confirm_an_unpaid_order(db, merchant, buyer):  # noqa: F811
    order = _order(db, merchant, buyer, OrderStatus.PENDING, TransactionStatus.PENDING)

    resp = _merchant_client(db, merchant).patch(
        f"/merchants/me/orders/{order.id}/status", json={"status": "processing"}
    )

    assert resp.status_code == 400
    db.refresh(order)
    assert order.status == OrderStatus.PENDING


def test_status_update_rejects_unknown_status(db, merchant, buyer):  # noqa: F811
    order = _order(db, merchant, buyer, OrderStatus.PROCESSING, TransactionStatus.PAID)

    resp = _merchant_client(db, merchant).patch(
        f"/merchants/me/orders/{order.id}/status", json={"status": "Shipped!"}
    )

    assert resp.status_code == 422


def test_merchant_sees_only_orders_a_payment_landed_on(db, merchant, buyer):  # noqa: F811
    unpaid = _order(db, merchant, buyer, OrderStatus.PENDING, TransactionStatus.PENDING)
    expired = _order(
        db, merchant, buyer, OrderStatus.CANCELLED, TransactionStatus.EXPIRED
    )
    paid = _order(db, merchant, buyer, OrderStatus.PROCESSING, TransactionStatus.PAID)

    rows = _merchant_client(db, merchant).get("/merchants/me/orders").json()

    assert {row["id"] for row in rows} == {paid.id}
    assert rows[0]["payment_status"] == "paid"
    assert unpaid.id and expired.id


def test_merchant_performance_ignores_unpaid_checkouts(db, merchant, buyer):  # noqa: F811
    _order(db, merchant, buyer, OrderStatus.PENDING, TransactionStatus.PENDING, total=900)
    _order(db, merchant, buyer, OrderStatus.PROCESSING, TransactionStatus.PAID, total=500)

    body = _merchant_client(db, merchant).get("/merchants/me/performance").json()

    assert body["total_orders"] == 1
    assert body["active_orders"] == 1
    assert body["total_revenue"] == 500


def test_buyer_current_orders_are_active_and_show_payment(db, merchant, buyer):  # noqa: F811
    user, _history = buyer
    awaiting = _order(db, merchant, buyer, OrderStatus.PENDING)
    _order(db, merchant, buyer, OrderStatus.DELIVERED, TransactionStatus.PAID)
    _order(db, merchant, buyer, OrderStatus.CANCELLED, TransactionStatus.EXPIRED)

    rows = _client(db, user).get("/orders/me/current").json()

    assert [(row["order_id"], row["payment_status"]) for row in rows] == [
        (awaiting.id, "awaiting_payment")
    ]


def test_buyer_history_and_detail_agree_on_payment(db, merchant, buyer):  # noqa: F811
    user, _history = buyer
    order = _order(db, merchant, buyer, OrderStatus.CANCELLED, TransactionStatus.REFUND_PENDING)
    client = _client(db, user)

    history = client.get("/orders/me/history").json()
    detail = client.get(f"/orders/me/{order.id}").json()

    assert history[0]["payment_status"] == detail["payment_status"] == "refund_pending"
    assert history[0]["status"] == detail["status"] == "cancelled"


def test_status_columns_reject_unknown_values(db, merchant, buyer):  # noqa: F811
    order = _order(db, merchant, buyer, OrderStatus.PENDING)

    order.status = "Paid"
    with pytest.raises(StatementError):
        db.commit()
    db.rollback()


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"payout_type": "gcash", "ewallet_number": "09171234567"}, 200),
        ({"payout_type": "gcash"}, 422),
        ({"payout_type": "bank", "bank_code": "BDO"}, 422),
        ({"payout_type": "paypal", "ewallet_number": "x"}, 422),
    ],
)
def test_payout_info_is_validated(db, merchant, payload, expected):  # noqa: F811
    resp = _merchant_client(db, merchant).put("/merchants/me/payout-info", json=payload)
    assert resp.status_code == expected

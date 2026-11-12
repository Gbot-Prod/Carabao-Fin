"""Order status transitions, payment status and delivery confirmation.

The one place that moves ``orders.status``. Payment (via
``order_reservations.settle_checkout_payment``) is the only way out of
``pending``; merchants act on paid orders only. Only the buyer, or the
auto-confirm sweep after the holding window, may mark an order delivered.
Payouts depend on ``delivered``, so merchants never set it.
"""

import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists
from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.statuses import OrderStatus, PaymentStatus, TransactionStatus
from app.models.transaction import Transaction
from app.services import notifications
from app.services.order_reservations import cancel_order

IN_TRANSIT_STATUSES = frozenset({OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY})
# Statuses the order has left the merchant in; drives the "shipped" flag.
SHIPPED_STATUSES = IN_TRANSIT_STATUSES | {OrderStatus.DELIVERED}
# Not finished yet: includes unpaid checkouts, which still hold stock.
ACTIVE_ORDER_STATUSES = frozenset(
    {
        OrderStatus.PENDING,
        OrderStatus.PROCESSING,
        OrderStatus.SHIPPED,
        OrderStatus.OUT_FOR_DELIVERY,
    }
)
CLOSED_ORDER_STATUSES = frozenset({OrderStatus.DELIVERED, OrderStatus.CANCELLED})

# Transaction states meaning money reached us for the order.
MONEY_RECEIVED_STATUSES = frozenset(
    {
        TransactionStatus.PAID,
        TransactionStatus.REFUND_PENDING,
        TransactionStatus.REFUNDED,
    }
)

# Transitions a merchant may make. "pending" is awaiting payment, so only the
# payment webhook or the expiry sweep moves it; "delivered" is the buyer's.
MERCHANT_TRANSITIONS: dict[OrderStatus, frozenset[OrderStatus]] = {
    OrderStatus.PENDING: frozenset(),
    OrderStatus.PROCESSING: frozenset({OrderStatus.SHIPPED, OrderStatus.CANCELLED}),
    OrderStatus.SHIPPED: frozenset(
        {OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED}
    ),
    OrderStatus.OUT_FOR_DELIVERY: frozenset({OrderStatus.CANCELLED}),
    OrderStatus.DELIVERED: frozenset(),
    OrderStatus.CANCELLED: frozenset(),
}


class InvalidTransition(ValueError):
    """The merchant asked for a move MERCHANT_TRANSITIONS doesn't allow."""


class PaymentInProgress(RuntimeError):
    """Cancelling now could race a payment that is still going through."""


def payment_status(order: Order) -> PaymentStatus:
    """The order's payment state, from its transactions.

    A landed payment wins over refunds of extra payments, so an order paid once
    and charged twice still reads as paid.
    """
    received = {txn.status for txn in order.transactions}
    if TransactionStatus.PAID in received:
        return PaymentStatus.PAID
    if TransactionStatus.REFUND_PENDING in received:
        return PaymentStatus.REFUND_PENDING
    if TransactionStatus.REFUNDED in received:
        return PaymentStatus.REFUNDED
    if order.status == OrderStatus.PENDING:
        return PaymentStatus.AWAITING_PAYMENT
    return PaymentStatus.UNPAID


def money_received_clause():
    """SQL filter: orders a payment has landed on. What merchants get to see."""
    return exists().where(
        Transaction.order_id == Order.id,
        Transaction.status.in_(MONEY_RECEIVED_STATUSES),
    )


def apply_merchant_transition(order: Order, new_status: OrderStatus, db: Session):
    """Move ``order`` to ``new_status`` for its merchant; the caller commits.

    Raises InvalidTransition or PaymentInProgress, leaving the order unchanged.
    """
    allowed = MERCHANT_TRANSITIONS.get(order.status, frozenset())
    if new_status not in allowed:
        raise InvalidTransition(
            f"Cannot transition order from '{order.status}' to '{new_status}'"
        )

    if new_status == OrderStatus.CANCELLED:
        if not cancel_order(order, db):
            raise PaymentInProgress(
                "A payment for this order is in progress; try again shortly"
            )
    elif new_status == OrderStatus.SHIPPED:
        mark_shipped(order)
    else:
        order.status = new_status
        if new_status == OrderStatus.OUT_FOR_DELIVERY:
            notifications.notify(
                db,
                notifications.buyer_id(order),
                notifications.ORDER_OUT_FOR_DELIVERY,
                f"Order {notifications.order_ref(order)} is out for delivery",
                "Your produce is on its way today.",
                "/track",
            )


def auto_confirm_days() -> int:
    """Days after shipping before an unconfirmed order counts as received."""
    return int(os.getenv("ORDER_AUTO_CONFIRM_DAYS", "7"))


def auto_confirm_at(order: Order) -> datetime | None:
    """When an in-transit order will auto-confirm, or None if it won't."""
    if order.status not in IN_TRANSIT_STATUSES or order.shipped_at is None:
        return None
    return order.shipped_at + timedelta(days=auto_confirm_days())


def mark_shipped(order: Order) -> None:
    order.status = OrderStatus.SHIPPED
    if order.shipped_at is None:
        order.shipped_at = datetime.now(UTC)
    notifications.notify(
        order,
        notifications.buyer_id(order),
        notifications.ORDER_SHIPPED,
        f"Order {notifications.order_ref(order)} has shipped",
        "Follow its estimated progress on the Track page.",
        "/track",
    )


def mark_delivered(order: Order, confirmed_by: str) -> None:
    order.status = OrderStatus.DELIVERED
    order.delivered_at = datetime.now(UTC)
    order.delivery_confirmed_by = confirmed_by
    notifications.notify(
        order,
        notifications.buyer_id(order),
        notifications.ORDER_DELIVERED,
        f"Order {notifications.order_ref(order)} was delivered",
        "Enjoy your produce. You can now review the farm.",
        notifications.order_link(order),
    )


def auto_confirm_delivered_orders(db: Session, days: int) -> int:
    """Confirm in-transit orders the buyer left unconfirmed past the window.

    The row lock makes this safe when multiple API workers run the sweep.
    """
    cutoff = datetime.now(UTC) - timedelta(days=days)
    due_order_ids = [
        order_id
        for (order_id,) in (
            db.query(Order.id)
            .filter(
                Order.status.in_(IN_TRANSIT_STATUSES),
                Order.shipped_at.isnot(None),
                Order.shipped_at < cutoff,
            )
            .all()
        )
    ]
    confirmed = 0

    for order_id in due_order_ids:
        order = (
            db.query(Order)
            .filter(Order.id == order_id)
            .with_for_update()
            .first()
        )
        if not order or order.status not in IN_TRANSIT_STATUSES:
            continue
        mark_delivered(order, confirmed_by="auto")
        confirmed += 1

    return confirmed

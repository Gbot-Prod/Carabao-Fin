"""Order status transitions, payment status and delivery confirmation.

The one place that moves ``orders.status``. Payment (via
``order_reservations.settle_checkout_payment``) is the only way out of
``pending``; merchants act on paid orders only. Only the buyer, or the
auto-confirm sweep after the holding window, may mark an order delivered.
Payouts depend on ``delivered``, so merchants never set it.
"""

import os
from datetime import UTC, datetime, time, timedelta, timezone

from sqlalchemy import exists
from sqlalchemy.orm import Session, object_session

from app.models.order import Order
from app.models.shipment import Shipment
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
CLOSED_ORDER_STATUSES = frozenset(
    {OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.PAYMENT_MISMATCH}
)

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
    OrderStatus.PAYMENT_MISMATCH: frozenset(),
}


# Why a farm may cancel; the label is what the buyer reads. The web and mobile
# cancel prompts offer these same keys. "other" needs a note.
MERCHANT_CANCEL_REASONS: dict[str, str] = {
    "out_of_stock": "Out of stock",
    "quality": "The produce did not meet quality standards",
    "cannot_deliver": "The farm cannot deliver to this address or date",
    "buyer_request": "The buyer asked to cancel",
    "other": "Other",
}
MERCHANT_CANCEL_NOTE_MAX = 300


def merchant_cancel_text(reason: str, note: str | None) -> str:
    """The reason as the buyer reads it, e.g. ``Out of stock: rain hit the crop``."""
    note = (note or "").strip()
    if reason == "other":
        return note
    label = MERCHANT_CANCEL_REASONS[reason]
    return f"{label}: {note}" if note else label


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


def apply_merchant_transition(
    order: Order,
    new_status: OrderStatus,
    db: Session,
    cancel_reason: str | None = None,
):
    """Move ``order`` to ``new_status`` for its merchant; the caller commits.

    ``cancel_reason`` is the buyer-facing text (``merchant_cancel_text``) and is
    required to cancel. Raises InvalidTransition or PaymentInProgress, leaving
    the order unchanged.
    """
    allowed = MERCHANT_TRANSITIONS.get(order.status, frozenset())
    if new_status not in allowed:
        raise InvalidTransition(
            f"Cannot transition order from '{order.status}' to '{new_status}'"
        )

    if new_status == OrderStatus.CANCELLED:
        if not cancel_reason:
            raise InvalidTransition("Give a reason to cancel this order")
        cancel_paid_order(
            order,
            db,
            f"The farm cancelled this order. Reason: {cancel_reason.rstrip('.')}.",
            record=cancel_reason,
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


def cancel_paid_order(
    order: Order, db: Session, reason: str, record: str | None = None
) -> None:
    """Cancel ``order`` and tell the buyer; the caller commits (CF-0051).

    ``reason`` is the notification text; ``record`` (default: ``reason``) is
    kept on the order for the order page. Raises PaymentInProgress, leaving
    the order unchanged, while a payment for an unpaid order may still go
    through.
    """
    # Only payment moves an order out of pending, so any other status was paid.
    was_paid = order.status != OrderStatus.PENDING
    if not cancel_order(order, db):
        raise PaymentInProgress(
            "A payment for this order is in progress; try again shortly"
        )
    order.cancel_reason = (record or reason)[:400]
    refund_note = " Your payment will be refunded." if was_paid else ""
    close_shipment_if_done(order)
    notifications.notify(
        db,
        notifications.buyer_id(order),
        notifications.ORDER_CANCELLED,
        f"Order {notifications.order_ref(order)} was cancelled",
        f"{reason}{refund_note}",
        notifications.order_link(order),
    )


def unshipped_cancel_days() -> int:
    """Days a paid order may wait in processing before it is cancelled (CF-0045)."""
    return int(os.getenv("ORDER_UNSHIPPED_CANCEL_DAYS", "5"))


def cancel_unshipped_orders(db: Session, days: int) -> int:
    """Cancel paid orders the merchant did not ship within ``days`` (CF-0045).

    The clock starts when the payment landed. The order's money moves to
    ``refund_pending``, so an admin can refund the buyer. The row lock makes
    this safe when multiple API workers run the sweep.
    """
    cutoff = datetime.now(UTC) - timedelta(days=days)
    due_order_ids = [
        order_id
        for (order_id,) in (
            db.query(Order.id)
            .filter(
                Order.status == OrderStatus.PROCESSING,
                exists().where(
                    Transaction.order_id == Order.id,
                    Transaction.status == TransactionStatus.PAID,
                    Transaction.paid_at < cutoff,
                ),
            )
            .all()
        )
    ]
    cancelled = 0

    for order_id in due_order_ids:
        order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
        if not order or order.status != OrderStatus.PROCESSING:
            continue
        cancel_paid_order(
            order,
            db,
            f"The farm did not ship it within {days} days of payment.",
        )
        notifications.notify(
            db,
            notifications.merchant_user_id(order),
            notifications.ORDER_CANCELLED,
            f"Order {notifications.order_ref(order)} was cancelled",
            f"It was not shipped within {days} days of payment. "
            "The buyer will be refunded.",
            "/merchantDashboard",
        )
        cancelled += 1

    return cancelled


def auto_confirm_days() -> int:
    """Days after shipping before an unconfirmed order counts as received."""
    return int(os.getenv("ORDER_AUTO_CONFIRM_DAYS", "7"))


# Requested delivery dates are Philippine calendar days (UTC+8, no DST).
_PH_TZ = timezone(timedelta(hours=8))


def auto_confirm_at(order: Order, days: int | None = None) -> datetime | None:
    """When an in-transit order will auto-confirm, or None if it won't.

    The window starts at shipping or at the start of the requested delivery
    day, whichever is later, so an order shipped early cannot confirm (and
    become payable) before the buyer could get it (CF-0050).
    """
    if order.status not in IN_TRANSIT_STATUSES or order.shipped_at is None:
        return None
    start = order.shipped_at
    if start.tzinfo is None:  # SQLite drops the zone
        start = start.replace(tzinfo=UTC)
    requested = getattr(order, "requested_delivery_date", None)
    if requested is not None:
        delivery_day = datetime.combine(requested, time.min, tzinfo=_PH_TZ)
        start = max(start, delivery_day)
    return start + timedelta(days=auto_confirm_days() if days is None else days)


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


SHIPMENT_COMPLETED = "completed"


def close_shipment_if_done(order: Order) -> None:
    """Mark the order's shipment completed once none of its orders is open.

    Shipment.status was never advanced, so a finished batch read in_transit
    forever (CF-0053).
    """
    shipment_id = getattr(order, "shipment_id", None)
    try:
        db = object_session(order) if shipment_id else None
    except Exception:  # not a database row (a test double)
        db = None
    if db is None:
        return
    db.flush()
    still_open = (
        db.query(Order.id)
        .filter(
            Order.shipment_id == shipment_id,
            Order.status.in_(ACTIVE_ORDER_STATUSES),
        )
        .first()
    )
    if still_open is None:
        db.query(Shipment).filter(Shipment.id == shipment_id).update(
            {Shipment.status: SHIPMENT_COMPLETED}, synchronize_session=False
        )


def mark_delivered(order: Order, confirmed_by: str) -> None:
    order.status = OrderStatus.DELIVERED
    order.delivered_at = datetime.now(UTC)
    order.closed_at = order.delivered_at
    order.delivery_confirmed_by = confirmed_by
    close_shipment_if_done(order)
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
        order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
        if not order or order.status not in IN_TRANSIT_STATUSES:
            continue
        due_at = auto_confirm_at(order, days)
        if due_at is None or due_at > datetime.now(UTC):
            continue  # waits for its requested delivery day (CF-0050)
        mark_delivered(order, confirmed_by="auto")
        confirmed += 1

    return confirmed

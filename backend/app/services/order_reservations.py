"""Release stock held by checkout orders that never receive payment."""

import logging
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.cart import Cart
from app.models.order import Order
from app.models.produce import Produce
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.services import notifications
from app.services.paymongo import (
    PaidPayment,
    expire_checkout_session,
    paid_payment_from_session,
    retrieve_checkout_session,
)

logger = logging.getLogger(__name__)


# CF-0045 (B50): unpaid (PENDING) orders one buyer may hold at once. Each one
# keeps its stock reserved until paid, cancelled, or the TTL runs out, so
# without a cap one account could keep a farm's stock unavailable to others.
# A multi-farm cart places one order per farm; the cart size bounds that.
MAX_OPEN_PENDING_ORDERS = 10


def open_pending_order_count(db: Session, user: User) -> int:
    return (
        db.query(Order.id)
        .filter(Order.user_id == user.id, Order.status == OrderStatus.PENDING)
        .count()
    )


def reservation_ttl_minutes() -> int:
    """How long a checkout holds stock, and how long its PayMongo session lives."""
    return int(os.getenv("ORDER_RESERVATION_TTL_MINUTES", "30"))


def _item_value(item: dict, *keys: str) -> int | None:
    for key in keys:
        value = item.get(key)
        if value is not None:
            try:
                return int(value)
            except (TypeError, ValueError):
                return None
    return None


def close_checkout_sessions(order: Order, db: Session) -> bool:
    """Expire the order's open PayMongo sessions so none can be paid later.

    Returns False if any session could not be confirmed closed, either because a
    payment is paid or in progress or because PayMongo could not be reached.
    """
    session_ids = [
        session_id
        for (session_id,) in (
            db.query(Transaction.paymongo_session_id)
            .filter(
                Transaction.order_id == order.id,
                Transaction.status == TransactionStatus.PENDING,
                Transaction.paymongo_session_id.isnot(None),
            )
            .all()
        )
    ]
    for session_id in session_ids:
        try:
            if not expire_checkout_session(session_id):
                logger.info(
                    "Checkout session %s has a payment in progress; keeping order %s",
                    session_id,
                    order.id,
                )
                return False
        except Exception:
            logger.exception("Could not expire checkout session %s", session_id)
            return False
    return True


def release_order_reservation(
    order: Order, db: Session, transaction_status: TransactionStatus
) -> bool:
    """Return an unpaid order's stock exactly once and close its checkout.

    Returns False (and keeps the stock held) while one of its PayMongo sessions
    may still be paid; the webhook or a later sweep settles it.
    """
    if order.status != OrderStatus.PENDING:
        return False
    if not close_checkout_sessions(order, db):
        return False

    restore_order_stock(order, db)
    _mark_cancelled(order)

    (
        db.query(Transaction)
        .filter(
            Transaction.order_id == order.id,
            Transaction.status == TransactionStatus.PENDING,
        )
        .update({Transaction.status: transaction_status}, synchronize_session=False)
    )
    return True


def restore_order_stock(order: Order, db: Session) -> None:
    """Put the order's item quantities back on their produce listings."""
    lines = []
    for item in order.items or []:
        if not isinstance(item, dict):
            continue
        produce_id = _item_value(item, "produce_id", "produceId", "id")
        quantity = _item_value(item, "quantity") or 0
        if produce_id and quantity > 0:
            lines.append((produce_id, quantity))

    # Same lock order as placing an order, so the two can't deadlock.
    for produce_id, quantity in sorted(lines):
        produce = (
            db.query(Produce).filter(Produce.id == produce_id).with_for_update().first()
        )
        if produce:
            produce.stock_quantity += quantity


def _mark_cancelled(order: Order) -> None:
    order.status = OrderStatus.CANCELLED
    order.closed_at = datetime.now(UTC)


def cancel_order(order: Order, db: Session) -> bool:
    """Cancel an order: return its stock and flag its payment for refund.

    An unpaid order also has its checkout closed so it can't be paid afterwards;
    returns False (order unchanged) while a payment for it may still go through.
    Paid transactions move to ``refund_pending`` so they are never paid out to
    the merchant.

    Stock comes back only while the produce is still at the farm
    (``processing``). A shipped or out-for-delivery order has left the farm, so
    its units are not sold again (CF-0048).
    """
    if order.status == OrderStatus.PENDING:
        return release_order_reservation(
            order, db, transaction_status=TransactionStatus.EXPIRED
        )

    if order.status == OrderStatus.PROCESSING:
        restore_order_stock(order, db)
    _mark_cancelled(order)

    (
        db.query(Transaction)
        .filter(
            Transaction.order_id == order.id,
            Transaction.status == TransactionStatus.PAID,
        )
        .update(
            {Transaction.status: TransactionStatus.REFUND_PENDING},
            synchronize_session=False,
        )
    )
    return True


PAYMENT_CURRENCY = "PHP"


def payment_mismatch(txn: Transaction, payment: PaidPayment) -> str | None:
    """Why ``payment`` is not exactly ``txn``'s amount in PHP, or None (CF-0005).

    A payment that doesn't say its amount or currency counts as a mismatch.
    """
    expected = int(txn.amount) * 100
    problems = []
    if payment.amount != expected:
        problems.append(f"amount {payment.amount} centavos, expected {expected}")
    if (payment.currency or "").upper() != PAYMENT_CURRENCY:
        problems.append(f"currency {payment.currency!r}, expected {PAYMENT_CURRENCY}")
    return "; ".join(problems) or None


def _flag_payment_mismatch(
    txn: Transaction, order: Order, payment: PaidPayment, reason: str, db: Session
) -> None:
    """Close the order as payment_mismatch, flag the money for refund, alert admins."""
    txn.status = TransactionStatus.REFUND_PENDING
    restore_order_stock(order, db)
    order.status = OrderStatus.PAYMENT_MISMATCH
    order.closed_at = datetime.now(UTC)
    ref = notifications.order_ref(order)
    logger.error(
        "Payment mismatch on order %s (transaction %s, payment %s): %s",
        order.id,
        txn.id,
        payment.id,
        reason,
    )
    notifications.notify_admins(
        db,
        notifications.PAYMENT_MISMATCH,
        f"Payment mismatch on {ref}",
        f"PayMongo payment {payment.id or '(no id)'}: {reason}. The order was not "
        "marked paid; the payment is flagged for refund.",
        "/admin/orders",
    )
    notifications.notify(
        db,
        notifications.buyer_id(order),
        notifications.PAYMENT_MISMATCH,
        f"We couldn't confirm the payment for {ref}",
        "The amount we received doesn't match your order. We will refund it; "
        "contact support if you have questions.",
        notifications.order_link(order),
    )


def settle_checkout_payment(
    txn: Transaction, payment: PaidPayment, db: Session
) -> str:
    """Record a PayMongo payment for ``txn``; the caller commits.

    Only a pending transaction on a still-pending order, paid exactly
    ``txn.amount`` in PHP, moves the order to processing. Money that lands on a
    closed transaction or a cancelled order is flagged ``refund_pending``
    instead, so a cancelled order is never revived. A payment of the wrong
    amount or currency closes the order as ``payment_mismatch`` (CF-0005).

    Returns "paid", "refund", "mismatch" or "duplicate".
    """
    # Lock the order before the transaction, the same order cancel takes them.
    order = db.query(Order).filter(Order.id == txn.order_id).with_for_update().first()
    db.refresh(txn, with_for_update=True)

    if txn.status in (
        TransactionStatus.PAID,
        TransactionStatus.REFUND_PENDING,
        TransactionStatus.REFUNDED,
    ):
        return "duplicate"

    txn.paymongo_payment_id = payment.id
    txn.paid_at = datetime.now(UTC)

    if (
        txn.status != TransactionStatus.PENDING
        or not order
        or order.status != OrderStatus.PENDING
    ):
        txn.status = TransactionStatus.REFUND_PENDING
        return "refund"

    mismatch = payment_mismatch(txn, payment)
    if mismatch:
        _flag_payment_mismatch(txn, order, payment, mismatch, db)
        return "mismatch"

    txn.status = TransactionStatus.PAID
    order.status = OrderStatus.PROCESSING
    ref = notifications.order_ref(order)
    notifications.notify(
        db,
        notifications.buyer_id(order),
        notifications.ORDER_PAID,
        f"Payment received for {ref}",
        "The farm is now preparing your order.",
        notifications.order_link(order),
    )
    notifications.notify(
        db,
        notifications.merchant_user_id(order),
        notifications.NEW_ORDER,
        f"New paid order {ref}",
        f"PHP {getattr(order, 'total_price', 0):,}. Open your dashboard to prepare it.",
        "/merchantDashboard",
    )
    # Drop only what this order bought: a multi-merchant checkout (C1) leaves
    # the other merchants' items in the cart until their orders are paid.
    cart = db.query(Cart).filter(Cart.user_id == txn.user_id).first()
    if cart:
        bought = {
            _item_value(item, "produce_id", "produceId", "id")
            for item in order.items or []
            if isinstance(item, dict)
        }
        cart.items = [
            item
            for item in cart.items or []
            if not (
                isinstance(item, dict)
                and _item_value(item, "produce_id", "produceId", "id") in bought
            )
        ]
    return "paid"


def settle_paid_sessions(order: Order, db: Session) -> bool:
    """Settle a pending order whose PayMongo checkout was paid but never recorded.

    Covers a missed or rejected webhook: PayMongo won't expire a paid session,
    so without this the order would sit in ``pending`` forever. The caller
    commits. Returns True if the order was settled as paid.
    """
    open_txns = (
        db.query(Transaction)
        .filter(
            Transaction.order_id == order.id,
            Transaction.status == TransactionStatus.PENDING,
            Transaction.paymongo_session_id.isnot(None),
        )
        .all()
    )
    for txn in open_txns:
        try:
            session = retrieve_checkout_session(txn.paymongo_session_id)
        except Exception:
            logger.exception(
                "Could not check checkout session %s", txn.paymongo_session_id
            )
            continue
        payment = paid_payment_from_session(session)
        if payment is None:
            continue
        outcome = settle_checkout_payment(txn, payment, db)
        if outcome == "mismatch":
            return False  # closed as payment_mismatch; nothing more to sweep
        if outcome == "paid":
            logger.warning(
                "Order %s was paid (session %s) but never settled; settled by sweep",
                order.id,
                txn.paymongo_session_id,
            )
            return True
    return False


def expire_stale_reservations(
    db: Session, ttl_minutes: int, paid_orders: list[Order] | None = None
) -> int:
    """Expire pending orders whose checkout reservation has elapsed.

    An elapsed order whose checkout was in fact paid is settled instead and,
    if ``paid_orders`` is given, appended to it so the caller can notify the
    merchant after committing. The row lock makes this safe when multiple API
    workers run the sweep.
    """
    cutoff = datetime.now(UTC) - timedelta(minutes=ttl_minutes)
    stale_order_ids = [
        order_id
        for (order_id,) in (
            db.query(Order.id)
            .filter(Order.status == OrderStatus.PENDING, Order.ordered_at < cutoff)
            .all()
        )
    ]
    released = 0

    for order_id in stale_order_ids:
        order = db.query(Order).filter(Order.id == order_id).with_for_update().first()
        if not order or order.status != OrderStatus.PENDING:
            continue

        # A newer checkout session may have been created for an older order.
        has_live_checkout = (
            db.query(Transaction.id)
            .filter(
                Transaction.order_id == order.id,
                Transaction.status == TransactionStatus.PENDING,
                Transaction.created_at >= cutoff,
            )
            .first()
        )
        if has_live_checkout:
            continue

        if settle_paid_sessions(order, db):
            if paid_orders is not None:
                paid_orders.append(order)
            continue

        if release_order_reservation(
            order, db, transaction_status=TransactionStatus.EXPIRED
        ):
            released += 1

    return released

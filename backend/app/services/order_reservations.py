"""Release stock held by checkout orders that never receive payment."""

import logging
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.cart import Cart
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.produce import Produce
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.transaction import Transaction
from app.services.paymongo import expire_checkout_session

logger = logging.getLogger(__name__)


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
        .filter(Transaction.order_id == order.id, Transaction.status == TransactionStatus.PENDING)
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
            db.query(Produce)
            .filter(Produce.id == produce_id)
            .with_for_update()
            .first()
        )
        if produce:
            produce.stock_quantity += quantity


def _mark_cancelled(order: Order) -> None:
    order.status = OrderStatus.CANCELLED


def cancel_order(order: Order, db: Session) -> bool:
    """Cancel an order: return its stock and flag its payment for refund.

    An unpaid order also has its checkout closed so it can't be paid afterwards;
    returns False (order unchanged) while a payment for it may still go through.
    Paid transactions move to ``refund_pending`` so they are never paid out to
    the merchant.
    """
    if order.status == OrderStatus.PENDING:
        return release_order_reservation(order, db, transaction_status=TransactionStatus.EXPIRED)

    restore_order_stock(order, db)
    _mark_cancelled(order)

    (
        db.query(Transaction)
        .filter(Transaction.order_id == order.id, Transaction.status == TransactionStatus.PAID)
        .update({Transaction.status: TransactionStatus.REFUND_PENDING}, synchronize_session=False)
    )
    return True


def settle_checkout_payment(
    txn: Transaction, payment_id: str | None, db: Session
) -> str:
    """Record a PayMongo payment for ``txn``; the caller commits.

    Only a pending transaction on a still-pending order moves the order to
    processing. Money that lands on a closed transaction or a cancelled order is
    flagged ``refund_pending`` instead, so a cancelled order is never revived.

    Returns "paid", "refund" or "duplicate".
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

    txn.paymongo_payment_id = payment_id
    txn.paid_at = datetime.now(UTC)

    if txn.status != TransactionStatus.PENDING or not order or order.status != OrderStatus.PENDING:
        txn.status = TransactionStatus.REFUND_PENDING
        return "refund"

    txn.status = TransactionStatus.PAID
    order.status = OrderStatus.PROCESSING
    if order.order_history_id:
        history = (
            db.query(OrderHistory)
            .filter(OrderHistory.id == order.order_history_id)
            .first()
        )
        if history:
            history.last_order_at = datetime.now(UTC)

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


def expire_stale_reservations(db: Session, ttl_minutes: int) -> int:
    """Expire pending orders whose checkout reservation has elapsed.

    The row lock makes this safe when multiple API workers run the sweep.
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
        order = (
            db.query(Order)
            .filter(Order.id == order_id)
            .with_for_update()
            .first()
        )
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

        if release_order_reservation(order, db, transaction_status=TransactionStatus.EXPIRED):
            released += 1

    return released

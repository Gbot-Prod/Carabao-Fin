"""Order status transitions and delivery confirmation.

Only the buyer, or the auto-confirm sweep after the holding window, may mark an
order delivered. Payouts depend on ``delivered``, so merchants never set it.
"""

import os
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.order import Order

IN_TRANSIT_STATUSES = {"shipped", "out_for_delivery"}

# Transitions a merchant may make. "delivered" is deliberately absent.
MERCHANT_TRANSITIONS: dict[str, set[str]] = {
    "pending": {"processing", "cancelled"},
    "processing": {"shipped", "cancelled"},
    "shipped": {"out_for_delivery", "cancelled"},
    "out_for_delivery": {"cancelled"},
    "delivered": set(),
    "cancelled": set(),
}


def auto_confirm_days() -> int:
    """Days after shipping before an unconfirmed order counts as received."""
    return int(os.getenv("ORDER_AUTO_CONFIRM_DAYS", "7"))


def auto_confirm_at(order: Order) -> datetime | None:
    """When an in-transit order will auto-confirm, or None if it won't."""
    if order.status not in IN_TRANSIT_STATUSES or order.shipped_at is None:
        return None
    return order.shipped_at + timedelta(days=auto_confirm_days())


def mark_shipped(order: Order) -> None:
    order.status = "shipped"
    if order.shipped_at is None:
        order.shipped_at = datetime.now(UTC)
    if order.current_order:
        order.current_order.status = "shipped"


def mark_delivered(order: Order, confirmed_by: str) -> None:
    order.status = "delivered"
    order.delivered_at = datetime.now(UTC)
    order.delivery_confirmed_by = confirmed_by
    if order.current_order:
        order.current_order.status = "delivered"


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

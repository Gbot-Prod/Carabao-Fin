"""Release stock held by checkout orders that never receive payment."""

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.produce import Produce
from app.models.transaction import Transaction


def _item_value(item: dict, *keys: str) -> int | None:
    for key in keys:
        value = item.get(key)
        if value is not None:
            try:
                return int(value)
            except (TypeError, ValueError):
                return None
    return None


def release_order_reservation(order: Order, db: Session, transaction_status: str) -> None:
    """Return an unpaid order's stock exactly once and close its checkout."""
    if order.status != "pending":
        return

    for item in order.items or []:
        if not isinstance(item, dict):
            continue
        produce_id = _item_value(item, "produce_id", "produceId", "id")
        quantity = _item_value(item, "quantity") or 0
        if not produce_id or quantity <= 0:
            continue
        produce = (
            db.query(Produce)
            .filter(Produce.id == produce_id)
            .with_for_update()
            .first()
        )
        if produce:
            produce.stock_quantity += quantity

    order.status = "cancelled"
    if order.current_order:
        order.current_order.status = "cancelled"

    (
        db.query(Transaction)
        .filter(Transaction.order_id == order.id, Transaction.status == "pending")
        .update({Transaction.status: transaction_status}, synchronize_session=False)
    )


def expire_stale_reservations(db: Session, ttl_minutes: int) -> int:
    """Expire pending orders whose checkout reservation has elapsed.

    The row lock makes this safe when multiple API workers run the sweep.
    """
    cutoff = datetime.now(UTC) - timedelta(minutes=ttl_minutes)
    stale_order_ids = [
        order_id
        for (order_id,) in (
            db.query(Order.id)
            .filter(Order.status == "pending", Order.ordered_at < cutoff)
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
        if not order or order.status != "pending":
            continue

        # A newer checkout session may have been created for an older order.
        has_live_checkout = (
            db.query(Transaction.id)
            .filter(
                Transaction.order_id == order.id,
                Transaction.status == "pending",
                Transaction.created_at >= cutoff,
            )
            .first()
        )
        if has_live_checkout:
            continue

        release_order_reservation(order, db, transaction_status="expired")
        released += 1

    return released

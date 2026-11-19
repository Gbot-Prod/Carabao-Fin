"""Remove personal delivery data from closed orders (CF-0044, RA 10173).

A set number of days after an order closes (default 14), the sweep removes its
chat, delivery address text, map pin, delivery notes and route. The buyer's
saved addresses are not touched. Totals, items, dates and payments stay.

An order with a refund still open keeps its details until the refund is done,
because the admin may need them to settle it.
"""

import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists
from sqlalchemy.orm import Session

from app.models.chat import ChatMessage, Conversation, ConversationRead
from app.models.order import Order
from app.models.shipment import Shipment
from app.models.statuses import TransactionStatus
from app.models.transaction import Transaction
from app.services.order_status import CLOSED_ORDER_STATUSES, SHIPMENT_COMPLETED

# Orders done per run, so one run stays a short transaction.
BATCH_SIZE = 500


def order_details_retention_days() -> int:
    return int(os.getenv("ORDER_DETAILS_RETENTION_DAYS", "14"))


def purge_closed_order_details(db: Session, days: int) -> int:
    """Remove chat and delivery details of orders closed ``days`` ago; the
    caller commits. Returns how many orders were purged."""
    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)
    order_ids = [
        order_id
        for (order_id,) in (
            db.query(Order.id)
            .filter(
                Order.status.in_(CLOSED_ORDER_STATUSES),
                Order.closed_at.isnot(None),
                Order.closed_at < cutoff,
                Order.details_purged_at.is_(None),
                ~exists().where(
                    Transaction.order_id == Order.id,
                    Transaction.status == TransactionStatus.REFUND_PENDING,
                ),
            )
            .order_by(Order.id)
            .limit(BATCH_SIZE)
            .all()
        )
    ]
    if not order_ids:
        return 0

    conversation_ids = (
        db.query(Conversation.id)
        .filter(Conversation.kind == "order", Conversation.order_id.in_(order_ids))
        .scalar_subquery()
    )
    for model in (ConversationRead, ChatMessage):
        db.query(model).filter(
            model.conversation_id.in_(conversation_ids)
        ).delete(synchronize_session=False)
    db.query(Conversation).filter(
        Conversation.kind == "order", Conversation.order_id.in_(order_ids)
    ).delete(synchronize_session=False)

    db.query(Order).filter(Order.id.in_(order_ids)).update(
        {
            Order.delivery_address: None,
            Order.delivery_lat: None,
            Order.delivery_lng: None,
            Order.notes: None,
            Order.route_waypoints: None,
            Order.details_purged_at: now,
        },
        synchronize_session=False,
    )

    _clear_finished_routes(db, order_ids)
    return len(order_ids)


def _clear_finished_routes(db: Session, order_ids: list[int]) -> None:
    """A shipment route holds every stop's pin. Clear it once all of its
    orders are purged."""
    shipment_ids = {
        shipment_id
        for (shipment_id,) in db.query(Order.shipment_id)
        .filter(Order.id.in_(order_ids), Order.shipment_id.isnot(None))
        .distinct()
    }
    if not shipment_ids:
        return
    db.query(Shipment).filter(
        Shipment.id.in_(shipment_ids),
        Shipment.status == SHIPMENT_COMPLETED,
        ~exists().where(
            Order.shipment_id == Shipment.id, Order.details_purged_at.is_(None)
        ),
    ).update({Shipment.route_waypoints: []}, synchronize_session=False)

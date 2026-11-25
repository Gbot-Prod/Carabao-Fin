"""Buyer disputes of a merchant-set delivery (ORDER_PROOF_PHOTOS_PLAN.md, Phase 2).

The merchant marks an order delivered with a drop-off photo. For
DELIVERY_DISPUTE_HOURS after that, the buyer can say "I did not get this".
That freezes the payout (payout_service.delivery_payable) and tells the
admins and the merchant. An admin then decides:

- ``release``: the merchant gets paid (the order stays delivered).
- ``refund``: the paid transaction goes to ``refund_pending``, so the refund
  queue (/admin/refunds) lists it. The order stays delivered; its payment
  status shows the refund.

A dispute after the window goes to support chat.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.payout_batch import PayoutBatchItem
from app.models.statuses import OrderStatus, TransactionStatus
from app.models.transaction import Transaction
from app.models.user import User
from app.services import audit_log, notifications
from app.services.payout_service import dispute_hours

RELEASE = "release"
REFUND = "refund"
DECISIONS = (RELEASE, REFUND)


class DisputeError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def is_merchant_delivery(order: Order) -> bool:
    return (
        order.status == OrderStatus.DELIVERED
        and order.delivery_confirmed_by == "merchant"
    )


def dispute_until(order: Order) -> datetime | None:
    """End of the buyer's dispute window; None if the merchant did not set
    the delivery."""
    if not is_merchant_delivery(order) or order.delivered_at is None:
        return None
    return _aware(order.delivered_at) + timedelta(hours=dispute_hours())


def is_open(order: Order) -> bool:
    """A dispute waits for an admin decision."""
    return order.delivery_disputed_at is not None and order.dispute_resolution is None


def can_dispute(order: Order, now: datetime | None = None) -> bool:
    until = dispute_until(order)
    if until is None:
        return False
    if order.delivery_buyer_confirmed_at is not None:
        return False
    if order.delivery_disputed_at is not None:
        return False
    return (now or datetime.now(UTC)) < until


def open_dispute(db: Session, order: Order) -> None:
    """The buyer says the order did not arrive; the caller commits."""
    if not can_dispute(order):
        if order.delivery_disputed_at is not None:
            raise DisputeError(409, "You already reported this order")
        raise DisputeError(
            409,
            "You can no longer report this order here. Contact support in the chat.",
        )
    order.delivery_disputed_at = datetime.now(UTC)
    ref = notifications.order_ref(order)
    notifications.notify_admins(
        db,
        notifications.DELIVERY_DISPUTED,
        f"Delivery disputed: order {ref}",
        "The buyer says the order did not arrive. Check the photos and decide.",
        f"/admin/orders?order={order.id}",
    )
    notifications.notify(
        db,
        notifications.merchant_user_id(order),
        notifications.DELIVERY_DISPUTED,
        f"Order {ref}: the buyer says it did not arrive",
        "Payout for this order is on hold until Carabao checks the photos.",
        "/merchantDashboard",
    )


def _paid_transactions(db: Session, order: Order) -> list[Transaction]:
    return (
        db.query(Transaction)
        .filter(
            Transaction.order_id == order.id,
            Transaction.status == TransactionStatus.PAID,
        )
        .with_for_update()
        .all()
    )


def resolve_dispute(
    db: Session, order: Order, admin: User, decision: str, note: str | None
) -> None:
    """The admin decision on an open dispute; the caller commits. The order
    must be locked (with_for_update) by the caller."""
    if decision not in DECISIONS:
        raise DisputeError(422, "decision must be release or refund")
    if not is_open(order):
        raise DisputeError(409, "This order has no open dispute")

    before = {"dispute_resolution": None}
    after: dict = {"dispute_resolution": decision, "note": note}
    ref = notifications.order_ref(order)
    if decision == REFUND:
        txns = _paid_transactions(db, order)
        batched = (
            db.query(PayoutBatchItem.id)
            .filter(PayoutBatchItem.transaction_id.in_([t.id for t in txns]))
            .first()
            if txns
            else None
        )
        if batched is not None:
            raise DisputeError(409, "This order's money is already in a payout batch")
        for txn in txns:
            txn.status = TransactionStatus.REFUND_PENDING
        after["refund_pending_transactions"] = [t.id for t in txns]
        notifications.notify(
            db,
            notifications.buyer_id(order),
            notifications.REFUND,
            f"Order {ref}: you will get a refund",
            "Carabao checked your report. Your payment will be refunded.",
            notifications.order_link(order),
        )
        notifications.notify(
            db,
            notifications.merchant_user_id(order),
            notifications.DELIVERY_DISPUTED,
            f"Order {ref}: the buyer gets a refund",
            "Carabao checked the delivery photos and refunds the buyer. "
            "This order is not paid out.",
            "/merchantDashboard",
        )
    else:
        notifications.notify(
            db,
            notifications.buyer_id(order),
            notifications.DELIVERY_DISPUTED,
            f"Order {ref}: delivery confirmed",
            "Carabao checked the delivery photos. The order counts as delivered. "
            "Contact support in the chat if you need more help.",
            notifications.order_link(order),
        )
        notifications.notify(
            db,
            notifications.merchant_user_id(order),
            notifications.DELIVERY_DISPUTED,
            f"Order {ref}: payout released",
            "Carabao checked the delivery photos. You can now claim this order's "
            "earnings.",
            "/merchantDashboard",
        )

    order.dispute_resolution = decision
    order.dispute_resolved_at = datetime.now(UTC)
    order.dispute_resolved_by = admin.id
    audit_log.record_admin_action(
        db,
        admin=admin,
        action=audit_log.ORDER_DISPUTE_DECISION,
        target_type="order",
        target_id=order.id,
        before=before,
        after=after,
    )

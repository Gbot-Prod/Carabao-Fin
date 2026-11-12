from __future__ import annotations

import logging

from app.integrations.sms.semaphore import SemaphoreError, send_sms
from app.models.order import Order
from app.models.statuses import OrderStatus

logger = logging.getLogger(__name__)

_SHIP_STATUSES = frozenset({OrderStatus.SHIPPED, OrderStatus.OUT_FOR_DELIVERY})


def notify_order_shipped(
    *,
    phone_number: str | None,
    merchant_name: str,
    order_ref: str,
    status: str,
) -> None:
    """Fire-and-forget SMS to the buyer when an order ships. Never raises."""
    if not phone_number:
        return
    if status not in _SHIP_STATUSES:
        return

    verb = "has been shipped" if status == OrderStatus.SHIPPED else "is out for delivery"
    message = (
        f"Hi! Your Carabao order {order_ref} from {merchant_name} {verb}. "
        "Track your delivery in the app."
    )

    try:
        send_sms(number=phone_number, message=message)
        logger.info(
            "[sms] Sent ship notification to %s for order %s", phone_number, order_ref
        )
    except SemaphoreError as exc:
        logger.warning(
            "[sms] Could not send ship notification for %s: %s", order_ref, exc
        )


def notify_merchant_new_order(*, order: Order) -> None:
    """Fire-and-forget SMS to the farmer once an order is paid. Never raises."""
    merchant = order.merchant
    phone_number = merchant.contact_number if merchant is not None else None
    if not phone_number:
        return

    year = order.ordered_at.year if order.ordered_at else "XXXX"
    order_ref = f"CB-{year}-{order.id:04d}"
    item_count = sum(
        int(item.get("quantity") or 0)
        for item in order.items or []
        if isinstance(item, dict)
    )
    schedule = ""
    if order.requested_delivery_date:
        schedule = f" Deliver {order.requested_delivery_date.strftime('%b %d')}"
        if order.delivery_window:
            # Keep the SMS in the GSM charset; an en dash forces UCS-2 (70 chars).
            schedule += f", {order.delivery_window.replace('–', '-')}"
        schedule += "."
    message = (
        f"New Carabao order {order_ref}: {item_count} item(s), "
        f"PHP {order.total_price:,}.{schedule} Open your dashboard for details."
    )

    try:
        send_sms(number=phone_number, message=message)
        logger.info("[sms] Sent new-order notification for %s", order_ref)
    except SemaphoreError as exc:
        logger.warning(
            "[sms] Could not send new-order notification for %s: %s", order_ref, exc
        )

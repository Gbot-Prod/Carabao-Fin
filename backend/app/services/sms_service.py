from __future__ import annotations

import logging

from app.integrations.sms.semaphore import SemaphoreError, send_sms

logger = logging.getLogger(__name__)

_SHIP_STATUSES = {"shipped", "out_for_delivery"}


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

    verb = "has been shipped" if status == "shipped" else "is out for delivery"
    message = (
        f"Hi! Your Carabao order {order_ref} from {merchant_name} {verb}. "
        "Track your delivery in the app."
    )

    try:
        send_sms(number=phone_number, message=message)
        logger.info("[sms] Sent ship notification to %s for order %s", phone_number, order_ref)
    except SemaphoreError as exc:
        logger.warning("[sms] Could not send ship notification for %s: %s", order_ref, exc)

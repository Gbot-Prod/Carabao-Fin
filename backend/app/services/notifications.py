"""In-app notifications and channel preferences (U5).

``notify`` only adds the row to the session it is given (or the session that
owns ``obj``); the caller's commit saves it with the change it describes.

Preferences live in ``backend_users.notifications_preferences``:
``order_updates`` gates SMS, ``email_alerts`` gates email. A missing key means
yes. In-app notifications are always kept, since they are the record the bell
shows.
"""

from __future__ import annotations

from sqlalchemy.orm import Session, object_session
from sqlalchemy.orm.exc import UnmappedInstanceError

from app.models.notification import Notification

ORDER_PLACED = "order_placed"
ORDER_PAID = "order_paid"
NEW_ORDER = "new_order"  # to the merchant
ORDER_SHIPPED = "order_shipped"
ORDER_OUT_FOR_DELIVERY = "order_out_for_delivery"
ORDER_DELIVERED = "order_delivered"
REVIEW_RECEIVED = "review_received"
PAYOUT_RELEASED = "payout_released"
REFUND = "refund"


def wants(user, channel: str) -> bool:
    """Whether ``user`` accepts ``channel`` ("sms" or "email")."""
    if user is None:
        return False
    prefs = user.notifications_preferences or {}
    key = "order_updates" if channel == "sms" else "email_alerts"
    return prefs.get(key, True) is not False


def notify(
    session_or_obj,
    user_id: int | None,
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> None:
    if user_id is None:
        return
    if isinstance(session_or_obj, Session):
        db = session_or_obj
    else:
        try:
            db = object_session(session_or_obj)
        except UnmappedInstanceError:  # not a database row (e.g. a test double)
            db = None
    if db is None:
        return
    db.add(
        Notification(
            user_id=user_id,
            kind=kind,
            title=title[:120],
            body=(body or None) and body[:500],
            link=link,
        )
    )


def order_ref(order) -> str:
    ordered_at = getattr(order, "ordered_at", None)
    year = ordered_at.year if ordered_at else "XXXX"
    return f"CB-{year}-{getattr(order, 'id', None) or 0:04d}"


def buyer_id(order) -> int | None:
    return getattr(order, "user_id", None)


def order_link(order) -> str:
    return f"/orders/{getattr(order, 'id', '')}"


def merchant_user_id(order) -> int | None:
    merchant = getattr(order, "merchant", None)
    return getattr(merchant, "user_id", None)

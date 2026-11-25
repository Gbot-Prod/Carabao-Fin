"""In-app notifications and channel preferences (U5).

``notify`` only adds the row to the session it is given (or the session that
owns ``obj``); the caller's commit saves it with the change it describes.

Preferences live in ``backend_users.notifications_preferences``:
``order_updates`` gates SMS, ``email_alerts`` gates email. A missing key means
yes. In-app notifications are always kept, since they are the record the bell
shows.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session, object_session
from sqlalchemy.orm.exc import UnmappedInstanceError

from app.models.notification import Notification
from app.models.user import User

ORDER_PLACED = "order_placed"
ORDER_PAID = "order_paid"
NEW_ORDER = "new_order"  # to the merchant
ORDER_SHIPPED = "order_shipped"
ORDER_OUT_FOR_DELIVERY = "order_out_for_delivery"
ORDER_DELIVERED = "order_delivered"
ORDER_CANCELLED = "order_cancelled"  # CF-0051
REVIEW_RECEIVED = "review_received"
REVIEW_REPLY = "review_reply"  # to the buyer, first reply only (CF-0046)
PAYOUT_RELEASED = "payout_released"
REFUND = "refund"
PAYMENT_MISMATCH = "payment_mismatch"  # to admins (CF-0005)
PAYOUT_DESTINATION_CHANGED = "payout_destination_changed"  # CF-0004
PIN_UNREACHABLE = "pin_unreachable"  # to the buyer (pin quality, control 6)
LISTING_APPROVED = "listing_approved"  # to the merchant (guardrails Phase 1)
LISTING_REJECTED = "listing_rejected"
# Guardrails Phase 2 (services/listing_trust.py).
LISTING_BLOCKED = "listing_blocked"  # to the merchant: no new listings for now
LISTING_PENALTY_REVOKED = "listing_penalty_revoked"
MERCHANT_ACCOUNT_REVIEW = "merchant_account_review"  # to admins
# Guardrails Phase 3 (services/listing_reports.py).
LISTING_REPORTED = "listing_reported"  # to admins: first open report
# A buyer disputes a merchant-set delivery (services/delivery_dispute.py).
DELIVERY_DISPUTED = "delivery_disputed"


# Who a notification is for, on an account that is both buyer and farm owner.
BUYER = "buyer"
MERCHANT = "merchant"
ADMIN = "admin"
AUDIENCES = (BUYER, MERCHANT, ADMIN)


def audience_for(link: str | None) -> str:
    """The audience a stored link belongs to.

    Merchant notifications all link to ``/merchantDashboard`` (the apps route
    on that base), admin ones to ``/admin/...``; everything else is the buyer's.
    The migration that added ``audience`` used the same rule for old rows.
    """
    path = link or ""
    if path == "/merchantDashboard" or path.startswith(
        ("/merchantDashboard?", "/merchantDashboard/")
    ):
        return MERCHANT
    if path == "/admin" or path.startswith(("/admin/", "/admin?")):
        return ADMIN
    return BUYER


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
    audience: str | None = None,
) -> None:
    """Add an in-app notification. ``audience`` defaults to ``audience_for(link)``."""
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
            audience=audience or audience_for(link),
        )
    )


def format_order_ref(order_id: int | None, ordered_at: datetime | None) -> str:
    """The buyer-facing order number, e.g. ``CB-2026-0042`` (CF-0059).

    The one place this format is built; the order history search parses it.
    """
    year = ordered_at.year if ordered_at else "XXXX"
    return f"CB-{year}-{order_id or 0:04d}"


def order_ref(order) -> str:
    return format_order_ref(
        getattr(order, "id", None), getattr(order, "ordered_at", None)
    )


def buyer_id(order) -> int | None:
    return getattr(order, "user_id", None)


def order_link(order) -> str:
    return f"/orders/{getattr(order, 'id', '')}"


def merchant_user_id(order) -> int | None:
    merchant = getattr(order, "merchant", None)
    return getattr(merchant, "user_id", None)


def notify_admins(
    db: Session, kind: str, title: str, body: str | None = None, link: str | None = None
) -> None:
    """``notify`` every admin who isn't suspended; the caller commits."""
    for admin in db.query(User).filter(User.is_admin, ~User.is_suspended).all():
        notify(db, admin.id, kind, title, body, link)

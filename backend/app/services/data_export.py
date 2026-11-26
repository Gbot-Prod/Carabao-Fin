"""A copy of a person's own data, as one JSON document (CF-0069, B18).

Right to data portability (Philippine Data Privacy Act): the caller gets what
Carabao holds about them in a common format. Only their own data: the other
side of an order appears by farm name only, other people's chat messages are
left out, and secrets are never included (payout account numbers, TIN and
RSBSA numbers stay out; they are shown, masked, on the pages that use them).
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, cast

from sqlalchemy.orm import Session

from app.models.chat import ChatMessage, Conversation
from app.models.farm_follow import FarmFollow
from app.models.merchant import Merchant
from app.models.notification import Notification
from app.models.order import Order
from app.models.produce import Produce
from app.models.review import Review
from app.models.saved_produce import SavedProduce
from app.models.transaction import Transaction
from app.models.user import User
from app.models.user_address import UserAddress
from app.services.notifications import order_ref

FORMAT_VERSION = 1

# Farm profile fields of the owner's own farm that are safe to put in a file.
_FARM_FIELDS = (
    "merchant_name",
    "legal_business_name",
    "contact_email",
    "contact_number",
    "region",
    "province",
    "city",
    "barangay",
    "address",
    "postal_code",
    "available_days",
    "operating_hours",
    "delivery_price",
    "delivery_time",
    "paused_until",
    "pause_message",
    "created_at",
)


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _row(obj: Any, fields: tuple[str, ...]) -> dict[str, Any]:
    return {name: _iso(getattr(obj, name, None)) for name in fields}


def build_export(db: Session, user: User) -> dict[str, Any]:
    user_id = cast(int, user.id)
    name_rows: list[Any] = db.query(Merchant.id, Merchant.merchant_name).all()
    merchant_names: dict[int, str] = {int(r[0]): r[1] for r in name_rows}

    account = _row(
        user,
        (
            "id",
            "name",
            "email",
            "phone_number",
            "created_at",
            "profile_picture_url",
            "notifications_preferences",
        ),
    )

    addresses = [
        _row(
            a,
            (
                "label",
                "recipient_name",
                "recipient_phone",
                "region",
                "province",
                "city",
                "barangay",
                "address",
                "postal_code",
                "lat",
                "lng",
                "road_lat",
                "road_lng",
                "pin_confirmed",
                "pin_verified_at",
                "is_default",
                "created_at",
            ),
        )
        for a in db.query(UserAddress)
        .filter(UserAddress.user_id == user_id)
        .order_by(UserAddress.id)
    ]

    orders = []
    for order in (
        db.query(Order).filter(Order.user_id == user_id).order_by(Order.id).all()
    ):
        payments = [
            _row(t, ("amount", "status", "created_at", "paid_at", "refunded_at"))
            for t in db.query(Transaction)
            .filter(Transaction.order_id == order.id, Transaction.user_id == user_id)
            .order_by(Transaction.id)
        ]
        orders.append(
            {
                "order_reference": order_ref(order),
                "farm": merchant_names.get(cast(int, order.merchant_id)),
                **_row(
                    order,
                    (
                        "id",
                        "status",
                        "ordered_at",
                        "items",
                        "delivery_fee",
                        "total_price",
                        "delivery_address",
                        "pin_unreachable_at",
                        "pin_unreachable_note",
                        "notes",
                        "delivered_at",
                    ),
                ),
                "payments": payments,
            }
        )

    reviews = [
        {
            "farm": merchant_names.get(cast(int, r.merchant_id)),
            **_row(
                r,
                (
                    "order_id",
                    "rating",
                    "comment",
                    "merchant_reply",
                    "created_at",
                    "updated_at",
                ),
            ),
        }
        for r in db.query(Review).filter(Review.user_id == user_id).order_by(Review.id)
    ]

    following = [
        {
            "farm": merchant_names.get(cast(int, f.merchant_id)),
            "since": _iso(f.created_at),
        }
        for f in db.query(FarmFollow)
        .filter(FarmFollow.user_id == user_id)
        .order_by(FarmFollow.id)
    ]

    saved_rows: list[Any] = (
        db.query(Produce.name, Produce.merchant_id, SavedProduce.created_at)
        .join(SavedProduce, SavedProduce.produce_id == Produce.id)
        .filter(SavedProduce.user_id == user_id)
        .order_by(SavedProduce.id)
        .all()
    )
    saved = [
        {
            "produce": r[0],
            "farm": merchant_names.get(int(r[1])),
            "saved_at": _iso(r[2]),
        }
        for r in saved_rows
    ]

    # Only what this person wrote; the other side's messages are theirs.
    message_rows: list[Any] = (
        db.query(
            Conversation.kind,
            Conversation.order_id,
            ChatMessage.body,
            ChatMessage.created_at,
            Conversation.merchant_id,
        )
        .select_from(ChatMessage)
        .join(Conversation, Conversation.id == ChatMessage.conversation_id)
        .filter(ChatMessage.sender_id == user_id)
        .order_by(ChatMessage.id)
        .all()
    )
    messages = [
        {
            "conversation": r[0],
            "order_id": r[1],
            # Shop inquiries name the farm asked instead of an order.
            "farm": merchant_names.get(int(r[4])) if r[4] is not None else None,
            "body": r[2],
            "sent_at": _iso(r[3]),
        }
        for r in message_rows
    ]

    # CF-0073 (B82): in-app notifications are messages to this person.
    notifications = [
        _row(n, ("kind", "title", "body", "link", "created_at", "read_at"))
        for n in db.query(Notification)
        .filter(Notification.user_id == user_id)
        .order_by(Notification.id)
    ]

    farm = None
    merchant = db.query(Merchant).filter(Merchant.user_id == user_id).first()
    if merchant is not None:
        farm = _row(merchant, _FARM_FIELDS)

    return {
        "format_version": FORMAT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
        "account": account,
        "addresses": addresses,
        "orders": orders,
        "reviews": reviews,
        "following": following,
        "saved_produce": saved,
        "messages_sent": messages,
        "notifications": notifications,
        "farm": farm,
    }

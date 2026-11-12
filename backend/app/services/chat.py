"""Order chat (CH1): who may read and write, closing, read markers, SMS nudges.

Participants: the order's buyer, the farm's owner, and any admin (who can read
and join). Everyone else gets 404, so the chat's existence isn't revealed.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.integrations.sms.semaphore import SemaphoreError, send_sms
from app.models.chat import ChatMessage, Conversation, ConversationRead
from app.models.order import Order
from app.models.user import User
from app.services import notifications

logger = logging.getLogger(__name__)

CLOSE_AFTER_DELIVERY = timedelta(days=7)
SMS_AFTER = timedelta(minutes=15)
SMS_LOOKBACK = timedelta(days=1)
MAX_BODY = 2000


def role_in_order(order: Order, user: User) -> str | None:
    if order.user_id == user.id:
        return "buyer"
    merchant = order.merchant
    if merchant is not None and merchant.user_id == user.id:
        return "merchant"
    if user.is_admin:
        # Same rule as the admin API (E8c): admins need two-step verification.
        from app.api.routes.admin import admin_requires_two_factor

        if not admin_requires_two_factor() or user.two_factor_enabled:
            return "admin"
    return None


def require_role(order: Order | None, user: User) -> str:
    role = role_in_order(order, user) if order is not None else None
    if role is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return role


def closes_at(order: Order) -> datetime | None:
    if order.delivered_at is None:
        return None
    delivered = order.delivered_at
    if delivered.tzinfo is None:
        delivered = delivered.replace(tzinfo=UTC)
    return delivered + CLOSE_AFTER_DELIVERY


def is_closed(order: Order, now: datetime | None = None) -> bool:
    end = closes_at(order)
    return end is not None and (now or datetime.now(UTC)) >= end


def conversation_for(db: Session, order: Order, create: bool) -> Conversation | None:
    conv = db.query(Conversation).filter(Conversation.order_id == order.id).first()
    if conv is None and create:
        conv = Conversation(kind="order", order_id=order.id)
        db.add(conv)
        db.flush()
    return conv


def mark_read(db: Session, conv: Conversation, user: User, message_id: int) -> None:
    marker = (
        db.query(ConversationRead)
        .filter(
            ConversationRead.conversation_id == conv.id,
            ConversationRead.user_id == user.id,
        )
        .first()
    )
    if marker is None:
        db.add(
            ConversationRead(
                conversation_id=conv.id,
                user_id=user.id,
                last_read_message_id=message_id,
            )
        )
    elif message_id > marker.last_read_message_id:
        marker.last_read_message_id = message_id


def post_message(
    db: Session, order: Order, user: User, role: str, body: str
) -> ChatMessage:
    text = body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write a message first")
    if len(text) > MAX_BODY:
        raise HTTPException(
            status_code=422, detail=f"Keep messages under {MAX_BODY} characters"
        )
    if is_closed(order):
        raise HTTPException(
            status_code=403, detail="This chat closed 7 days after delivery"
        )
    conv = conversation_for(db, order, create=True)
    message = ChatMessage(
        conversation_id=conv.id, sender_id=user.id, sender_role=role, body=text
    )
    db.add(message)
    db.flush()
    mark_read(db, conv, user, message.id)

    ref = notifications.order_ref(order)
    sender = {"buyer": "The buyer", "merchant": "The farm", "admin": "Carabao support"}[
        role
    ]
    preview = text if len(text) <= 120 else text[:117] + "…"
    for recipient, link in (
        (order.user_id, f"/orders/{order.id}"),
        (notifications.merchant_user_id(order), "/merchantDashboard"),
    ):
        if recipient is not None and recipient != user.id:
            notifications.notify(
                db,
                recipient,
                "chat_message",
                f"{sender} wrote about {ref}",
                preview,
                link,
            )
    return message


def send_unread_merchant_sms(db: Session, now: datetime | None = None) -> int:
    """Text the farm about buyer/admin messages still unread after 15 minutes.

    One text per conversation per sweep; each message is texted at most once.
    Called from the background loop in main.py. Returns texts sent.
    """
    now = now or datetime.now(UTC)
    pending = (
        db.query(ChatMessage)
        .join(Conversation, Conversation.id == ChatMessage.conversation_id)
        .filter(
            Conversation.kind == "order",
            ChatMessage.sender_role != "merchant",
            ChatMessage.sms_sent_at.is_(None),
            ChatMessage.created_at <= now - SMS_AFTER,
            ChatMessage.created_at >= now - SMS_LOOKBACK,
        )
        .order_by(ChatMessage.conversation_id, ChatMessage.id)
        .all()
    )
    sent = 0
    by_conversation: dict[int, list[ChatMessage]] = {}
    for message in pending:
        by_conversation.setdefault(message.conversation_id, []).append(message)

    for conversation_id, messages in by_conversation.items():
        conv = db.get(Conversation, conversation_id)
        order = db.get(Order, conv.order_id) if conv and conv.order_id else None
        merchant = order.merchant if order else None
        owner = merchant.user if merchant else None
        read = (
            db.query(ConversationRead.last_read_message_id)
            .filter(
                ConversationRead.conversation_id == conversation_id,
                ConversationRead.user_id == (owner.id if owner else -1),
            )
            .scalar()
            or 0
        )
        unread = [m for m in messages if m.id > read]
        for m in messages:
            m.sms_sent_at = now  # read ones need no text either
        if not unread or merchant is None or not merchant.contact_number:
            continue
        if owner is not None and not notifications.wants(owner, "sms"):
            continue
        ref = notifications.order_ref(order)
        try:
            send_sms(
                number=merchant.contact_number,
                message=(
                    f"Carabao: {len(unread)} unread message(s) about order {ref}. "
                    "Open your dashboard to reply."
                ),
            )
            sent += 1
        except SemaphoreError as exc:
            logger.warning("[chat] Could not text merchant about %s: %s", ref, exc)
    return sent

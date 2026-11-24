"""Order chat (CH1) and shop inquiries: who may read and write, closing, read
markers, SMS nudges.

Order chat participants: the order's buyer, the farm's owner, and any admin (who
can read and join). Everyone else gets 404, so the chat's existence isn't revealed.

A shop inquiry (kind "shop") works the same way, but between a buyer and a farm
with no order, so buyers can ask before they buy. One inquiry per buyer and farm.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.integrations.sms.semaphore import SemaphoreError, send_sms
from app.models.chat import ChatMessage, Conversation, ConversationRead
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.user import User
from app.services import listing_checks, notifications

logger = logging.getLogger(__name__)

CLOSE_AFTER_DELIVERY = timedelta(days=7)
SMS_AFTER = timedelta(minutes=15)
SMS_LOOKBACK = timedelta(days=1)
MAX_BODY = 2000


def _admin_session(user: User) -> bool:
    # Same rule as the admin API (E8c, CF-0003, CF-0017): admins need two-step
    # verification, this session must have passed the TOTP step, and the token
    # must come from the admin site.
    return bool(
        user.is_admin
        and user.two_factor_enabled
        and user.mfa_session
        and user.token_surface == "admin"
    )


def role_in_order(order: Order, user: User) -> str | None:
    if order.user_id == user.id:
        return "buyer"
    merchant = order.merchant
    if merchant is not None and merchant.user_id == user.id:
        return "merchant"
    if _admin_session(user):
        return "admin"
    return None


def require_role(order: Order | None, user: User) -> str:
    role = role_in_order(order, user) if order is not None else None
    if role is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return role


def closes_at(order: Order) -> datetime | None:
    """7 days after the order was delivered or otherwise closed (CF-0044)."""
    closed = order.delivered_at or getattr(order, "closed_at", None)
    if closed is None:
        return None
    if closed.tzinfo is None:
        closed = closed.replace(tzinfo=UTC)
    return closed + CLOSE_AFTER_DELIVERY


def is_closed(order: Order, now: datetime | None = None) -> bool:
    # A purged order has no chat left, so it must not start a new one.
    if getattr(order, "details_purged_at", None) is not None:
        return True
    end = closes_at(order)
    return end is not None and (now or datetime.now(UTC)) >= end


def conversation_for(db: Session, order: Order, create: bool) -> Conversation | None:
    conv = db.query(Conversation).filter(Conversation.order_id == order.id).first()
    if conv is None and create:
        conv = Conversation(kind="order", order_id=order.id)
        db.add(conv)
        db.flush()
    return conv


def _clean_body(body: str) -> str:
    text = body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write a message first")
    if len(text) > MAX_BODY:
        raise HTTPException(
            status_code=422, detail=f"Keep messages under {MAX_BODY} characters"
        )
    return text


def _refuse_contact_details(role: str, text: str) -> None:
    """Guardrails Phase 3: buyers and farms keep contact and payment in Carabao.

    Admin messages are not checked: support may need to send a link.
    """
    if role not in ("buyer", "merchant"):
        return
    problem = listing_checks.chat_message_problem(text)
    if problem:
        raise HTTPException(status_code=422, detail=problem)


def _preview(text: str) -> str:
    return text if len(text) <= 120 else text[:117] + "…"


# --- Shop inquiries -----------------------------------------------------------


def role_in_inquiry(conv: Conversation, user: User) -> str | None:
    if conv.user_id == user.id:
        return "buyer"
    merchant = conv.merchant
    if merchant is not None and merchant.user_id == user.id:
        return "merchant"
    if _admin_session(user):
        return "admin"
    return None


def require_inquiry_role(conv: Conversation | None, user: User) -> str:
    role = None
    if conv is not None and conv.kind == "shop":
        role = role_in_inquiry(conv, user)
    if role is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    return role


def inquiry_for(
    db: Session, buyer: User, merchant: Merchant, create: bool
) -> Conversation | None:
    conv = (
        db.query(Conversation)
        .filter(
            Conversation.kind == "shop",
            Conversation.user_id == buyer.id,
            Conversation.merchant_id == merchant.id,
        )
        .first()
    )
    if conv is None and create:
        conv = Conversation(kind="shop", user_id=buyer.id, merchant_id=merchant.id)
        db.add(conv)
        db.flush()
    return conv


def inquiry_is_closed(merchant: Merchant | None) -> bool:
    """A farm that was removed or suspended takes no new messages."""
    if merchant is None or merchant.deleted_at is not None:
        return True
    if merchant.suspended_at is not None:
        return True
    owner = merchant.user
    return owner is None or bool(owner.is_suspended)


def post_inquiry_message(
    db: Session, conv: Conversation, user: User, role: str, body: str
) -> ChatMessage:
    text = _clean_body(body)
    _refuse_contact_details(role, text)
    merchant = conv.merchant
    if inquiry_is_closed(merchant):
        raise HTTPException(
            status_code=403, detail="This farm is not taking messages right now"
        )
    message = ChatMessage(
        conversation_id=conv.id, sender_id=user.id, sender_role=role, body=text
    )
    db.add(message)
    db.flush()
    mark_read(db, conv, user, message.id)

    titles = {
        "buyer": "A buyer asked about your farm",
        "merchant": f"{merchant.merchant_name} replied to your question",
        "admin": "Carabao support joined a chat",
    }
    # Each link opens this thread. Merchant links keep the /merchantDashboard
    # base the apps already route on; the query names the thread.
    for recipient, link in (
        (conv.user_id, f"/chats?farm={conv.merchant_id}"),
        (merchant.user_id, f"/merchantDashboard?inquiry={conv.id}"),
    ):
        if recipient is not None and recipient != user.id:
            notifications.notify(
                db, recipient, "chat_message", titles[role], _preview(text), link
            )
    return message


# --- Shared -------------------------------------------------------------------


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
    text = _clean_body(body)
    _refuse_contact_details(role, text)
    if is_closed(order):
        raise HTTPException(
            status_code=403, detail="This chat closed 7 days after the order closed"
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
    preview = _preview(text)
    # Each link opens this order's chat (merchant: see the inquiry links above).
    for recipient, link in (
        (order.user_id, f"/chats?order={order.id}"),
        (notifications.merchant_user_id(order), f"/merchantDashboard?order={order.id}"),
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
            Conversation.kind.in_(("order", "shop")),
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
        if order is not None:
            merchant = order.merchant
        elif conv is not None and conv.kind == "shop":
            merchant = conv.merchant
        else:
            merchant = None
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
        if order is not None:
            ref = notifications.order_ref(order)
            about = f"about order {ref}"
        else:
            ref = f"inquiry {conversation_id}"
            about = "from a buyer asking about your farm"
        try:
            send_sms(
                number=merchant.contact_number,
                message=(
                    f"Carabao: {len(unread)} unread message(s) {about}. "
                    "Open your dashboard to reply."
                ),
            )
            sent += 1
        except SemaphoreError as exc:
            logger.warning("[chat] Could not text merchant about %s: %s", ref, exc)
    return sent

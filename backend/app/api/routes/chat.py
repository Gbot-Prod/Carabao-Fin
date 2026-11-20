"""Order chat API (CH1). Clients poll GET every 10 seconds while the chat is open."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.api.dependencies import ensure_phone_verified, get_current_user, get_db
from app.models.chat import ChatMessage, Conversation, ConversationRead
from app.models.order import Order
from app.models.user import User
from app.schemas.pagination import MAX_ID
from app.services import chat, notifications, rate_limit
from app.services.merchant_service import get_active_merchant

router = APIRouter(tags=["chat"])


class ChatMessageOut(BaseModel):
    id: int
    sender_role: str
    mine: bool
    body: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChatThread(BaseModel):
    order_id: int
    my_role: str
    closed: bool
    closes_at: datetime | None
    messages: list[ChatMessageOut]


class ChatPost(BaseModel):
    body: str = Field(min_length=1, max_length=chat.MAX_BODY)

    model_config = ConfigDict(extra="forbid")  # CF-0063


def _out(m: ChatMessage, user: User) -> ChatMessageOut:
    return ChatMessageOut(
        id=m.id,
        sender_role=m.sender_role,
        mine=m.sender_id == user.id,
        body=m.body,
        created_at=m.created_at,
    )


@router.get("/orders/{order_id}/messages", response_model=ChatThread)
def read_thread(
    order_id: int,
    after_id: int = Query(
        0, ge=0, le=MAX_ID, description="Only messages newer than this id"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = db.get(Order, order_id)
    role = chat.require_role(order, current_user)
    conv = chat.conversation_for(db, order, create=False)
    messages: list[ChatMessage] = []
    if conv is not None:
        messages = (
            db.query(ChatMessage)
            .filter(ChatMessage.conversation_id == conv.id, ChatMessage.id > after_id)
            .order_by(ChatMessage.id)
            .limit(200)
            .all()
        )
        if messages:
            chat.mark_read(db, conv, current_user, messages[-1].id)
            db.commit()
    return ChatThread(
        order_id=order.id,
        my_role=role,
        closed=chat.is_closed(order),
        closes_at=chat.closes_at(order),
        messages=[_out(m, current_user) for m in messages],
    )


@router.post("/orders/{order_id}/messages", response_model=ChatMessageOut)
def send_message(
    order_id: int,
    payload: ChatPost,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "order_chat_send", str(current_user.id))
    order = db.get(Order, order_id)
    role = chat.require_role(order, current_user)
    if role == "buyer":
        ensure_phone_verified(current_user)
    message = chat.post_message(db, order, current_user, role, payload.body)
    db.commit()
    db.refresh(message)
    return _out(message, current_user)


class ChatSummary(BaseModel):
    order_id: int
    order_ref: str
    order_status: str
    buyer_name: str | None
    closed: bool
    last_body: str
    last_sender_role: str
    last_mine: bool
    last_at: datetime
    unread: int


@router.get("/merchants/me/chats", response_model=list[ChatSummary])
def my_merchant_chats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The farm's order chats that have messages, newest message first.

    Read markers do not change here; opening a thread marks it read.
    """
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")

    rows = (
        db.query(Conversation, Order, User)
        .join(Order, Order.id == Conversation.order_id)
        .outerjoin(User, User.id == Order.user_id)
        .filter(Conversation.kind == "order", Order.merchant_id == merchant.id)
        .all()
    )
    conv_ids = [conv.id for conv, _, _ in rows]
    if not conv_ids:
        return []

    last_ids = dict(
        db.query(ChatMessage.conversation_id, func.max(ChatMessage.id))
        .filter(ChatMessage.conversation_id.in_(conv_ids))
        .group_by(ChatMessage.conversation_id)
        .all()
    )
    last_msgs = {
        m.conversation_id: m
        for m in db.query(ChatMessage).filter(ChatMessage.id.in_(last_ids.values()))
    }
    unread = dict(
        db.query(ChatMessage.conversation_id, func.count(ChatMessage.id))
        .outerjoin(
            ConversationRead,
            and_(
                ConversationRead.conversation_id == ChatMessage.conversation_id,
                ConversationRead.user_id == current_user.id,
            ),
        )
        .filter(
            ChatMessage.conversation_id.in_(conv_ids),
            or_(
                ChatMessage.sender_id.is_(None),
                ChatMessage.sender_id != current_user.id,
            ),
            ChatMessage.id > func.coalesce(ConversationRead.last_read_message_id, 0),
        )
        .group_by(ChatMessage.conversation_id)
        .all()
    )

    out: list[ChatSummary] = []
    for conv, order, buyer in rows:
        last = last_msgs.get(conv.id)
        if last is None:
            continue
        out.append(
            ChatSummary(
                order_id=order.id,
                order_ref=notifications.order_ref(order),
                order_status=order.status,
                buyer_name=(buyer.name or None) if buyer else None,
                closed=chat.is_closed(order),
                last_body=last.body,
                last_sender_role=last.sender_role,
                last_mine=last.sender_id == current_user.id,
                last_at=last.created_at,
                unread=unread.get(conv.id, 0),
            )
        )
    out.sort(key=lambda s: s.last_at, reverse=True)
    return out

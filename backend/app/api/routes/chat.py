"""Order chat API (CH1). Clients poll GET every 10 seconds while the chat is open."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.dependencies import ensure_phone_verified, get_current_user, get_db
from app.models.chat import ChatMessage
from app.models.order import Order
from app.models.user import User
from app.services import chat

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
    after_id: int = Query(0, ge=0, description="Only messages newer than this id"),
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
    order = db.get(Order, order_id)
    role = chat.require_role(order, current_user)
    if role == "buyer":
        ensure_phone_verified(current_user)
    message = chat.post_message(db, order, current_user, role, payload.body)
    db.commit()
    db.refresh(message)
    return _out(message, current_user)

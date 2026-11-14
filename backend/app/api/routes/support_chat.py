"""Support chat (CH2): any user talks to the admins. Same tables as order chat."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes.admin import _require_admin, admin_requires_two_factor
from app.api.routes.chat import ChatMessageOut, _out
from app.models.chat import ChatMessage, Conversation, ConversationRead
from app.models.user import User
from app.services import chat, notifications

router = APIRouter(tags=["support"])


class SupportThread(BaseModel):
    conversation_id: int | None
    my_role: str
    closed: bool = False
    closes_at: datetime | None = None
    messages: list[ChatMessageOut]


class SupportPost(BaseModel):
    body: str = Field(min_length=1, max_length=chat.MAX_BODY)


class SupportConversationSummary(BaseModel):
    conversation_id: int
    user_id: int | None
    user_name: str | None
    user_email: str | None
    last_message: str | None
    last_at: datetime | None
    unread: int


def _messages(
    db: Session, conv: Conversation | None, after_id: int
) -> list[ChatMessage]:
    if conv is None:
        return []
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.conversation_id == conv.id, ChatMessage.id > after_id)
        .order_by(ChatMessage.id)
        .limit(200)
        .all()
    )


def _thread(
    db: Session, conv: Conversation | None, user: User, role: str, after_id: int
):
    rows = _messages(db, conv, after_id)
    if conv is not None and rows:
        chat.mark_read(db, conv, user, rows[-1].id)
        db.commit()
    return SupportThread(
        conversation_id=conv.id if conv else None,
        my_role=role,
        messages=[_out(m, user) for m in rows],
    )


def _post(
    db: Session, conv: Conversation, user: User, role: str, body: str
) -> ChatMessage:
    text = body.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Write a message first")
    message = ChatMessage(
        conversation_id=conv.id, sender_id=user.id, sender_role=role, body=text
    )
    db.add(message)
    db.flush()
    chat.mark_read(db, conv, user, message.id)
    return message


def _admins(db: Session) -> list[User]:
    admins = db.query(User).filter(User.is_admin, ~User.is_suspended).all()
    if not admin_requires_two_factor():
        return admins
    return [a for a in admins if a.two_factor_enabled]


# ── The user's side ─────────────────────────────────────────────────────────


@router.get("/support/messages", response_model=SupportThread)
def my_support_thread(
    after_id: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = (
        db.query(Conversation)
        .filter(Conversation.kind == "support", Conversation.user_id == current_user.id)
        .first()
    )
    return _thread(db, conv, current_user, "user", after_id)


@router.post("/support/messages", response_model=ChatMessageOut)
def write_to_support(
    payload: SupportPost,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conv = (
        db.query(Conversation)
        .filter(Conversation.kind == "support", Conversation.user_id == current_user.id)
        .first()
    )
    if conv is None:
        conv = Conversation(kind="support", user_id=current_user.id)
        db.add(conv)
        db.flush()
    message = _post(db, conv, current_user, "user", payload.body)
    name = current_user.name
    for admin in _admins(db):
        if admin.id != current_user.id:
            notifications.notify(
                db,
                admin.id,
                "support_message",
                f"Support message from {name or current_user.email or current_user.phone_number}",
                payload.body.strip()[:120],
                "/admin/support",
            )
    db.commit()
    db.refresh(message)
    return _out(message, current_user)


# ── The admins' side ────────────────────────────────────────────────────────


@router.get("/admin/support", response_model=list[SupportConversationSummary])
def list_support_conversations(
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    convs = db.query(Conversation).filter(Conversation.kind == "support").all()
    # What this admin has read; any admin's reply also counts as handled.
    out = []
    for conv in convs:
        last = (
            db.query(ChatMessage)
            .filter(ChatMessage.conversation_id == conv.id)
            .order_by(ChatMessage.id.desc())
            .first()
        )
        read_to = (
            db.query(ConversationRead.last_read_message_id)
            .filter(
                ConversationRead.conversation_id == conv.id,
                ConversationRead.user_id == admin.id,
            )
            .scalar()
            or 0
        )
        last_admin_reply = (
            db.query(func.max(ChatMessage.id))
            .filter(
                ChatMessage.conversation_id == conv.id,
                ChatMessage.sender_role == "admin",
            )
            .scalar()
            or 0
        )
        unread = (
            db.query(func.count(ChatMessage.id))
            .filter(
                ChatMessage.conversation_id == conv.id,
                ChatMessage.sender_role == "user",
                ChatMessage.id > max(read_to, last_admin_reply),
            )
            .scalar()
            or 0
        )
        user = db.get(User, conv.user_id) if conv.user_id else None
        out.append(
            SupportConversationSummary(
                conversation_id=conv.id,
                user_id=conv.user_id,
                user_name=(user.name or None) if user else None,
                user_email=user.email if user else None,
                last_message=last.body[:120] if last else None,
                last_at=last.created_at if last else None,
                unread=unread,
            )
        )
    # Unanswered first, then most recent.
    out.sort(
        key=lambda c: (c.unread == 0, -(c.last_at.timestamp() if c.last_at else 0))
    )
    return out


def _support_conv(db: Session, conversation_id: int) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.kind != "support":
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.get("/admin/support/{conversation_id}/messages", response_model=SupportThread)
def admin_read_support(
    conversation_id: int,
    after_id: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    return _thread(db, _support_conv(db, conversation_id), admin, "admin", after_id)


@router.post("/admin/support/{conversation_id}/messages", response_model=ChatMessageOut)
def admin_reply_support(
    conversation_id: int,
    payload: SupportPost,
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
):
    conv = _support_conv(db, conversation_id)
    message = _post(db, conv, admin, "admin", payload.body)
    notifications.notify(
        db,
        conv.user_id,
        "support_reply",
        "Carabao support replied",
        payload.body.strip()[:120],
        "/profile",
    )
    db.commit()
    db.refresh(message)
    return _out(message, admin)

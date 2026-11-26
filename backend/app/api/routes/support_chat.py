"""Support chat (CH2): any user talks to the admins. Same tables as order chat."""

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.api.routes.admin import _id_term, _require_admin
from app.api.routes.chat import ChatMessageOut, _out
from app.core.sql import SortOrder, ilike_contains
from app.models.chat import ChatMessage, Conversation, ConversationRead
from app.models.user import User
from app.schemas.pagination import MAX_FILTER_TEXT, MAX_ID, MAX_OFFSET
from app.services import chat, notifications, rate_limit

router = APIRouter(tags=["support"])


class SupportThread(BaseModel):
    conversation_id: int | None
    my_role: str
    closed: bool = False
    closes_at: datetime | None = None
    messages: list[ChatMessageOut]


class SupportPost(BaseModel):
    body: str = Field(min_length=1, max_length=chat.MAX_BODY)

    model_config = ConfigDict(extra="forbid")  # CF-0063


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
    return [a for a in admins if a.two_factor_enabled]


# ── The user's side ─────────────────────────────────────────────────────────


@router.get("/support/messages", response_model=SupportThread)
def my_support_thread(
    after_id: int = Query(0, ge=0, le=MAX_ID),
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
    rate_limit.enforce_action(db, "support_chat_send", str(current_user.id))
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
    sender = name or current_user.email or current_user.phone_number
    for admin in _admins(db):
        if admin.id != current_user.id:
            notifications.notify(
                db,
                admin.id,
                "support_message",
                f"Support message from {sender}",
                payload.body.strip()[:120],
                "/admin/support",
            )
    db.commit()
    db.refresh(message)
    return _out(message, current_user)


# ── The admins' side ────────────────────────────────────────────────────────


# CF-0076 (B61): window of the admin support list (unanswered first).
SUPPORT_LIST_DEFAULT = 100
SUPPORT_LIST_MAX = 200

# "unread": unanswered first, then most recent (the inbox order).
SupportSort = Literal["unread", "user", "when"]


@router.get("/admin/support", response_model=list[SupportConversationSummary])
def list_support_conversations(
    limit: int = Query(SUPPORT_LIST_DEFAULT, ge=1, le=SUPPORT_LIST_MAX),
    offset: int = Query(0, ge=0, le=MAX_OFFSET),
    # The user's name or email, or a user id.
    search: str | None = Query(None, alias="q", max_length=MAX_FILTER_TEXT),
    sort: SupportSort = "unread",
    order: SortOrder = "desc",
    db: Session = Depends(get_db),
    admin: User = Depends(_require_admin),
) -> list[SupportConversationSummary]:
    """Unanswered first, then most recent; a fixed number of queries.

    CF-0076: was 4 queries per conversation and a sort in Python over every
    conversation, on a page the admins poll every 30 s.
    """
    of_conv: Any = ChatMessage.conversation_id == Conversation.id
    last_id = (
        select(func.max(ChatMessage.id)).where(of_conv).correlate(Conversation)
    ).scalar_subquery()
    # What this admin has read; any admin's reply also counts as handled.
    read_to = (
        select(func.coalesce(func.max(ConversationRead.last_read_message_id), 0))
        .where(
            ConversationRead.conversation_id == Conversation.id,
            ConversationRead.user_id == admin.id,
        )
        .correlate(Conversation)
    ).scalar_subquery()
    last_admin_reply = (
        select(func.coalesce(func.max(ChatMessage.id), 0))
        .where(of_conv, ChatMessage.sender_role == "admin")
        .correlate(Conversation)
    ).scalar_subquery()
    seen = case((last_admin_reply > read_to, last_admin_reply), else_=read_to)
    unread = (
        select(func.count(ChatMessage.id))
        .where(of_conv, ChatMessage.sender_role == "user", ChatMessage.id > seen)
        .correlate(Conversation)
    ).scalar_subquery()

    def user_col(column: Any) -> Any:
        return (
            select(column)
            .where(User.id == Conversation.user_id)
            .correlate(Conversation)
            .scalar_subquery()
        )

    desc = order == "desc"
    # Message ids grow with time, so the last id orders by recency.
    recent = last_id.desc().nulls_last() if desc else last_id.asc().nulls_last()
    tiebreak = Conversation.id.desc() if desc else Conversation.id.asc()
    if sort == "user":
        name = func.lower(func.coalesce(user_col(User.name), user_col(User.email)))
        order_by: tuple[Any, ...] = (
            (name.desc() if desc else name.asc()).nulls_last(),
            tiebreak,
        )
    elif sort == "when":
        order_by = (recent, tiebreak)
    else:
        order_by = (case((unread == 0, 1), else_=0), recent, tiebreak)

    query = db.query(
        Conversation.id,
        Conversation.user_id,
        last_id.label("last_id"),
        unread.label("unread"),
    ).filter(Conversation.kind == "support")
    term = (search or "").strip()
    if term:
        matches = [
            ilike_contains(user_col(User.name), term),
            ilike_contains(user_col(User.email), term),
        ]
        if (number := _id_term(term)) is not None:
            matches.append(Conversation.user_id == number)
        query = query.filter(or_(*matches))
    rows = query.order_by(*order_by).offset(offset).limit(limit).all()
    message_ids = [r.last_id for r in rows if r.last_id is not None]
    # Two batch reads for the window: its last messages and its users.
    last_messages = {
        m.id: m
        for m in (
            db.query(ChatMessage).filter(ChatMessage.id.in_(message_ids)).all()
            if message_ids
            else []
        )
    }
    user_ids = [r.user_id for r in rows if r.user_id is not None]
    users = {
        u.id: u
        for u in (
            db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else []
        )
    }
    out = []
    for r in rows:
        last = last_messages.get(r.last_id)
        user = users.get(r.user_id)
        out.append(
            SupportConversationSummary(
                conversation_id=r.id,
                user_id=r.user_id,
                user_name=(user.name or None) if user else None,
                user_email=user.email if user else None,
                last_message=last.body[:120] if last else None,
                last_at=last.created_at if last else None,
                unread=int(r.unread or 0),
            )
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
    after_id: int = Query(0, ge=0, le=MAX_ID),
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

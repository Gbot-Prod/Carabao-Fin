"""Order chat API (CH1) and shop inquiries (a buyer asks a farm before buying).

Clients poll GET every 10 seconds while the chat is open.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, contains_eager

from app.api.dependencies import ensure_phone_verified, get_current_user, get_db
from app.models.chat import ChatMessage, Conversation, ConversationRead
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.shopPage import ShopPage
from app.models.user import User
from app.schemas.pagination import MAX_ID
from app.services import chat, notifications, rate_limit
from app.services.account_suspension import merchant_is_public
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


def _last_and_unread(
    db: Session, conv_ids: list[int], user: User
) -> tuple[dict[int, ChatMessage], dict[int, int]]:
    """The newest message and the unread count (from others) per conversation."""
    if not conv_ids:
        return {}, {}
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
                ConversationRead.user_id == user.id,
            ),
        )
        .filter(
            ChatMessage.conversation_id.in_(conv_ids),
            or_(
                ChatMessage.sender_id.is_(None),
                ChatMessage.sender_id != user.id,
            ),
            ChatMessage.id > func.coalesce(ConversationRead.last_read_message_id, 0),
        )
        .group_by(ChatMessage.conversation_id)
        .all()
    )
    return last_msgs, unread


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
    last_msgs, unread = _last_and_unread(db, conv_ids, current_user)

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


# Paid orders. A buyer can start a chat on these from the chat list.
CHAT_START_STATUSES = ("processing", "shipped", "out_for_delivery", "delivered")
MAX_BUYER_CHATS = 100


class BuyerChatSummary(BaseModel):
    order_id: int
    order_ref: str
    order_status: str
    merchant_id: int | None
    farm_name: str | None
    farm_logo_url: str | None
    closed: bool
    # Empty when the order has no messages yet (the buyer can start the chat).
    last_body: str | None
    last_sender_role: str | None
    last_mine: bool
    last_at: datetime | None
    ordered_at: datetime | None
    unread: int


@router.get("/users/me/chats", response_model=list[BuyerChatSummary])
def my_buyer_chats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The buyer's order chats with farms.

    Orders that have messages come first, newest message first. Then paid orders
    with an open chat and no messages, newest order first. Read markers do not
    change here; opening a thread marks it read.
    """
    rows = (
        db.query(Order, Merchant, Conversation)
        .outerjoin(Merchant, Merchant.id == Order.merchant_id)
        .outerjoin(ShopPage, ShopPage.merchant_id == Merchant.id)
        .options(contains_eager(Merchant.shop_page))
        .outerjoin(
            Conversation,
            and_(Conversation.order_id == Order.id, Conversation.kind == "order"),
        )
        .filter(Order.user_id == current_user.id, Order.merchant_id.isnot(None))
        .order_by(Order.id.desc())
        .all()
    )
    conv_ids = [conv.id for _, _, conv in rows if conv is not None]
    last_msgs, unread = _last_and_unread(db, conv_ids, current_user)

    with_messages: list[BuyerChatSummary] = []
    without_messages: list[BuyerChatSummary] = []
    for order, merchant, conv in rows:
        last = last_msgs.get(conv.id) if conv is not None else None
        closed = chat.is_closed(order)
        if last is None and (closed or order.status not in CHAT_START_STATUSES):
            continue
        summary = BuyerChatSummary(
            order_id=order.id,
            order_ref=notifications.order_ref(order),
            order_status=order.status,
            merchant_id=order.merchant_id,
            farm_name=(merchant.merchant_name or None) if merchant else None,
            farm_logo_url=(
                merchant.shop_page.logo_url
                if merchant is not None and merchant.shop_page is not None
                else None
            ),
            closed=closed,
            last_body=last.body if last else None,
            last_sender_role=last.sender_role if last else None,
            last_mine=bool(last and last.sender_id == current_user.id),
            last_at=last.created_at if last else None,
            ordered_at=order.ordered_at,
            unread=unread.get(conv.id, 0) if conv is not None else 0,
        )
        (with_messages if last else without_messages).append(summary)
    with_messages.sort(key=lambda c: c.last_at, reverse=True)
    return (with_messages + without_messages)[:MAX_BUYER_CHATS]


# --- Shop inquiries: a buyer asks a farm before buying -------------------------


class InquiryThread(BaseModel):
    conversation_id: int | None
    merchant_id: int
    my_role: str
    closed: bool
    closes_at: datetime | None = None
    messages: list[ChatMessageOut]


class InquirySummary(BaseModel):
    conversation_id: int
    merchant_id: int
    farm_name: str | None
    farm_logo_url: str | None
    buyer_name: str | None
    closed: bool
    last_body: str
    last_sender_role: str
    last_mine: bool
    last_at: datetime
    unread: int


MAX_INQUIRIES = 100


def _inquiry_thread(
    db: Session,
    conv: Conversation | None,
    merchant: Merchant,
    user: User,
    role: str,
    after_id: int,
) -> InquiryThread:
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
            chat.mark_read(db, conv, user, messages[-1].id)
            db.commit()
    return InquiryThread(
        conversation_id=conv.id if conv else None,
        merchant_id=merchant.id,
        my_role=role,
        closed=chat.inquiry_is_closed(merchant),
        messages=[_out(m, user) for m in messages],
    )


def _is_public(db: Session, merchant_id: int) -> bool:
    return (
        db.query(Merchant.id)
        .filter(Merchant.id == merchant_id, merchant_is_public())
        .first()
        is not None
    )


def _farm_for_buyer(db: Session, merchant_id: int, user: User) -> Merchant:
    merchant = db.get(Merchant, merchant_id)
    if merchant is None:
        raise HTTPException(status_code=404, detail="Merchant not found")
    if merchant.user_id == user.id:
        raise HTTPException(status_code=400, detail="This is your own farm")
    return merchant


@router.get("/merchants/{merchant_id}/inquiry/messages", response_model=InquiryThread)
def read_my_inquiry(
    merchant_id: int,
    after_id: int = Query(
        0, ge=0, le=MAX_ID, description="Only messages newer than this id"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The buyer's questions to a farm, no order needed. Empty until the first."""
    merchant = _farm_for_buyer(db, merchant_id, current_user)
    conv = chat.inquiry_for(db, current_user, merchant, create=False)
    # A farm hidden from buyers (removed, suspended, unpublished) has no chat to
    # start; one that already exists stays readable.
    if conv is None and not _is_public(db, merchant.id):
        raise HTTPException(status_code=404, detail="Merchant not found")
    return _inquiry_thread(db, conv, merchant, current_user, "buyer", after_id)


@router.post("/merchants/{merchant_id}/inquiry/messages", response_model=ChatMessageOut)
def send_my_inquiry(
    merchant_id: int,
    payload: ChatPost,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "order_chat_send", str(current_user.id))
    merchant = _farm_for_buyer(db, merchant_id, current_user)
    conv = chat.inquiry_for(db, current_user, merchant, create=False)
    if conv is None and not _is_public(db, merchant.id):
        raise HTTPException(status_code=404, detail="Merchant not found")
    ensure_phone_verified(current_user)
    if conv is None:
        conv = chat.inquiry_for(db, current_user, merchant, create=True)
    message = chat.post_inquiry_message(db, conv, current_user, "buyer", payload.body)
    db.commit()
    db.refresh(message)
    return _out(message, current_user)


@router.get("/inquiries/{conversation_id}/messages", response_model=InquiryThread)
def read_inquiry(
    conversation_id: int,
    after_id: int = Query(
        0, ge=0, le=MAX_ID, description="Only messages newer than this id"
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """An inquiry by id, for the farm (and admins) answering it."""
    conv = db.get(Conversation, conversation_id)
    role = chat.require_inquiry_role(conv, current_user)
    return _inquiry_thread(db, conv, conv.merchant, current_user, role, after_id)


@router.post("/inquiries/{conversation_id}/messages", response_model=ChatMessageOut)
def send_inquiry(
    conversation_id: int,
    payload: ChatPost,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "order_chat_send", str(current_user.id))
    conv = db.get(Conversation, conversation_id)
    role = chat.require_inquiry_role(conv, current_user)
    if role == "buyer":
        ensure_phone_verified(current_user)
    message = chat.post_inquiry_message(db, conv, current_user, role, payload.body)
    db.commit()
    db.refresh(message)
    return _out(message, current_user)


def _inquiry_rows(db: Session):
    return (
        db.query(Conversation, Merchant, User)
        .join(Merchant, Merchant.id == Conversation.merchant_id)
        .outerjoin(ShopPage, ShopPage.merchant_id == Merchant.id)
        .options(contains_eager(Merchant.shop_page))
        .outerjoin(User, User.id == Conversation.user_id)
        .filter(Conversation.kind == "shop")
    )


def _inquiry_summaries(db: Session, rows: list, user: User) -> list[InquirySummary]:
    """Inquiries that have messages, newest message first."""
    last_msgs, unread = _last_and_unread(db, [conv.id for conv, _, _ in rows], user)
    out: list[InquirySummary] = []
    for conv, merchant, buyer in rows:
        last = last_msgs.get(conv.id)
        if last is None:
            continue
        out.append(
            InquirySummary(
                conversation_id=conv.id,
                merchant_id=merchant.id,
                farm_name=merchant.merchant_name or None,
                farm_logo_url=(
                    merchant.shop_page.logo_url
                    if merchant.shop_page is not None
                    else None
                ),
                buyer_name=(buyer.name or None) if buyer else None,
                closed=chat.inquiry_is_closed(merchant),
                last_body=last.body,
                last_sender_role=last.sender_role,
                last_mine=last.sender_id == user.id,
                last_at=last.created_at,
                unread=unread.get(conv.id, 0),
            )
        )
    out.sort(key=lambda s: s.last_at, reverse=True)
    return out[:MAX_INQUIRIES]


@router.get("/users/me/inquiries", response_model=list[InquirySummary])
def my_buyer_inquiries(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The buyer's questions to farms (no order needed), newest message first."""
    rows = _inquiry_rows(db).filter(Conversation.user_id == current_user.id).all()
    return _inquiry_summaries(db, rows, current_user)


@router.get("/merchants/me/inquiries", response_model=list[InquirySummary])
def my_merchant_inquiries(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Questions buyers sent the farm before (or without) ordering."""
    merchant = get_active_merchant(db, current_user.id)
    if not merchant:
        raise HTTPException(status_code=404, detail="Merchant profile not found")
    rows = _inquiry_rows(db).filter(Conversation.merchant_id == merchant.id).all()
    return _inquiry_summaries(db, rows, current_user)

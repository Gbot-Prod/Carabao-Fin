"""Order chat (CH1), support chat (CH2) and shop inquiries share these tables."""

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


class Conversation(Base):
    __tablename__ = "conversations"
    # One inquiry per buyer and farm (kind "shop"). Other kinds leave merchant_id
    # empty, and empty values never clash.
    __table_args__ = (
        UniqueConstraint(
            "kind", "user_id", "merchant_id", name="uq_conversations_shop"
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    kind = Column(String(16), nullable=False, index=True)  # order | support | shop
    # One conversation per order (kind "order").
    order_id = Column(
        Integer,
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=True,
        unique=True,
    )
    # Who opened a support conversation (kind "support"), or the buyer asking a
    # farm before buying (kind "shop").
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # The farm a buyer is asking (kind "shop").
    merchant_id = Column(
        Integer,
        ForeignKey("merchants.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    messages = relationship(
        "ChatMessage", back_populates="conversation", order_by="ChatMessage.id"
    )
    merchant = relationship("Merchant")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(
        Integer,
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sender_id = Column(
        Integer, ForeignKey("backend_users.id", ondelete="SET NULL"), nullable=True
    )
    sender_role = Column(String(16), nullable=False)  # buyer | merchant | admin | user
    body = Column(Text, nullable=False)
    created_at = Column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    # Set once the merchant has been texted about this unread message (CH1).
    sms_sent_at = Column(DateTime(timezone=True), nullable=True)

    conversation = relationship("Conversation", back_populates="messages")


class ConversationRead(Base):
    """How far each participant has read a conversation."""

    __tablename__ = "conversation_reads"
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_conversation_reads"),
    )

    id = Column(Integer, primary_key=True)
    conversation_id = Column(
        Integer,
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer,
        ForeignKey("backend_users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    last_read_message_id = Column(Integer, nullable=False, default=0)

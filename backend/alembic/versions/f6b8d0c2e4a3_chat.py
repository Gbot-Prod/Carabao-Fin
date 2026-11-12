"""Order and support chat: conversations, messages, read markers (CH1, CH2).

Revision ID: f6b8d0c2e4a3
Revises: e5a7c9b1d3f2
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f6b8d0c2e4a3"
down_revision: str | Sequence[str] | None = "e5a7c9b1d3f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column(
            "order_id",
            sa.Integer(),
            sa.ForeignKey("orders.id", ondelete="CASCADE"),
            nullable=True,
            unique=True,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_conversations_id", "conversations", ["id"])
    op.create_index("ix_conversations_kind", "conversations", ["kind"])
    op.create_index("ix_conversations_user_id", "conversations", ["user_id"])

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sender_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("sender_role", sa.String(16), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("sms_sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_chat_messages_id", "chat_messages", ["id"])
    op.create_index(
        "ix_chat_messages_conversation_id", "chat_messages", ["conversation_id"]
    )
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"])

    op.create_table(
        "conversation_reads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "last_read_message_id", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_conversation_reads"),
    )
    op.create_index(
        "ix_conversation_reads_conversation_id",
        "conversation_reads",
        ["conversation_id"],
    )
    op.create_index("ix_conversation_reads_user_id", "conversation_reads", ["user_id"])


def downgrade() -> None:
    op.drop_table("conversation_reads")
    op.drop_table("chat_messages")
    op.drop_table("conversations")

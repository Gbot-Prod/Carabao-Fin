"""Shop page draft and publish.

The merchant edits draft_* columns; publish copies them to the live columns.
A merchant is public only after its shop page is published (published_at).
Rows that exist before this revision stay live: the draft is a copy of the
live values and published_at is set.

Revision ID: f3b7d1a9c5e2
Revises: e4a8c2f6b0d3
Create Date: 2026-11-19
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3b7d1a9c5e2"
down_revision: str | Sequence[str] | None = "e4a8c2f6b0d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("shop_pages", sa.Column("draft_title", sa.String(), nullable=True))
    op.add_column(
        "shop_pages", sa.Column("draft_description", sa.Text(), nullable=True)
    )
    op.add_column("shop_pages", sa.Column("draft_logo_url", sa.String(), nullable=True))
    op.add_column(
        "shop_pages", sa.Column("draft_banner_image_url", sa.String(), nullable=True)
    )
    op.add_column(
        "shop_pages",
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "UPDATE shop_pages SET draft_title = title,"
        " draft_description = description,"
        " draft_logo_url = logo_url,"
        " draft_banner_image_url = banner_image_url,"
        " published_at = now()"
    )
    op.alter_column("shop_pages", "draft_title", nullable=False)
    op.create_index(op.f("ix_shop_pages_published_at"), "shop_pages", ["published_at"])


def downgrade() -> None:
    op.drop_index(op.f("ix_shop_pages_published_at"), table_name="shop_pages")
    op.drop_column("shop_pages", "published_at")
    op.drop_column("shop_pages", "draft_banner_image_url")
    op.drop_column("shop_pages", "draft_logo_url")
    op.drop_column("shop_pages", "draft_description")
    op.drop_column("shop_pages", "draft_title")

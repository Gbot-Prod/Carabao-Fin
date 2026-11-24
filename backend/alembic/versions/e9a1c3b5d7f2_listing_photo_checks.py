"""Listing photo checks (produce guardrails Phase 4).

* produces.image_phash: the 64-bit perceptual hash of the listing photo, for
  the stolen-photo flag. Fill it for photos uploaded before this migration
  with ``uv run python scripts/backfill_photo_hashes.py``.
* produces.photo_check: the last vision check of the photo (JSON).

Revision ID: e9a1c3b5d7f2
Revises: a9d3f5b7c1e8
Create Date: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e9a1c3b5d7f2"
down_revision: str | Sequence[str] | None = "a9d3f5b7c1e8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("produces", sa.Column("image_phash", sa.BigInteger(), nullable=True))
    op.add_column("produces", sa.Column("photo_check", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("produces", "photo_check")
    op.drop_column("produces", "image_phash")

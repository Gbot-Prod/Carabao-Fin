"""
Lightweight, additive schema migrations.

Each entry is a raw SQL statement that is safe to run on every startup
(uses IF NOT EXISTS / idempotent DDL). Add new statements at the bottom —
never remove or reorder existing ones.
"""

from sqlalchemy import text
from sqlalchemy.engine import Engine

_MIGRATIONS: list[str] = [
    # 2025-05-06 — user profile picture
    "ALTER TABLE backend_users ADD COLUMN IF NOT EXISTS profile_picture_url VARCHAR",
    # 2025-05-07 — merchant shop page logo
    "ALTER TABLE shop_pages ADD COLUMN IF NOT EXISTS logo_url VARCHAR",
    # 2026-05-13 — admin review note on merchant applications
    "ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS admin_note VARCHAR",
    # 2026-05-13 — link application to merchant for cascade delete
    "ALTER TABLE merchant_applications ADD COLUMN IF NOT EXISTS merchant_id INTEGER REFERENCES merchants(id) ON DELETE CASCADE",
    "UPDATE merchant_applications ma SET merchant_id = m.id FROM merchants m WHERE m.user_id = ma.user_id AND ma.merchant_id IS NULL",
]


def run_migrations(engine: Engine) -> None:
    with engine.begin() as conn:
        for stmt in _MIGRATIONS:
            conn.execute(text(stmt))

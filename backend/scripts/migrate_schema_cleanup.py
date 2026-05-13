"""
Schema cleanup migration.

Changes applied:
  backend_users  : DROP member_since
  carts          : DROP total_items, total_price
  orders         : ADD user_id (FK -> backend_users, nullable)
  current_orders : DROP shipped, merchant_name
  order_histories: DROP total_orders, total_spent
  merchants      : operating_hours VARCHAR -> JSON, rating INTEGER -> FLOAT
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

STEPS = [
    # ── backend_users ────────────────────────────────────────────────────────
    (
        "backend_users: drop member_since",
        "ALTER TABLE backend_users DROP COLUMN IF EXISTS member_since",
    ),

    # ── carts ────────────────────────────────────────────────────────────────
    (
        "carts: drop total_items",
        "ALTER TABLE carts DROP COLUMN IF EXISTS total_items",
    ),
    (
        "carts: drop total_price",
        "ALTER TABLE carts DROP COLUMN IF EXISTS total_price",
    ),

    # ── orders ───────────────────────────────────────────────────────────────
    (
        "orders: add user_id column",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INTEGER",
    ),
    (
        "orders: add user_id FK (idempotent)",
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'fk_orders_user_id'
                  AND table_name = 'orders'
            ) THEN
                ALTER TABLE orders
                    ADD CONSTRAINT fk_orders_user_id
                    FOREIGN KEY (user_id)
                    REFERENCES backend_users(id)
                    ON DELETE SET NULL;
            END IF;
        END $$
        """,
    ),
    (
        "orders: create ix_orders_user_id",
        "CREATE INDEX IF NOT EXISTS ix_orders_user_id ON orders(user_id)",
    ),

    # ── current_orders ───────────────────────────────────────────────────────
    (
        "current_orders: drop shipped",
        "ALTER TABLE current_orders DROP COLUMN IF EXISTS shipped",
    ),
    (
        "current_orders: drop merchant_name",
        "ALTER TABLE current_orders DROP COLUMN IF EXISTS merchant_name",
    ),

    # ── order_histories ──────────────────────────────────────────────────────
    (
        "order_histories: drop total_orders",
        "ALTER TABLE order_histories DROP COLUMN IF EXISTS total_orders",
    ),
    (
        "order_histories: drop total_spent",
        "ALTER TABLE order_histories DROP COLUMN IF EXISTS total_spent",
    ),

    # ── merchants ────────────────────────────────────────────────────────────
    (
        "merchants: drop index on operating_hours (required before type change)",
        "DROP INDEX IF EXISTS ix_merchants_operating_hours",
    ),
    (
        "merchants: operating_hours VARCHAR -> JSON",
        # to_json() wraps existing plain strings as valid JSON string values
        "ALTER TABLE merchants ALTER COLUMN operating_hours TYPE JSON USING to_json(operating_hours)",
    ),
    (
        "merchants: rating INTEGER -> FLOAT",
        "ALTER TABLE merchants ALTER COLUMN rating TYPE FLOAT",
    ),
]


def get_database_url() -> str:
    load_dotenv()
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set.")
    return url


def main() -> None:
    if "--yes" not in sys.argv:
        raise SystemExit(
            "This script alters live schema. Re-run with --yes to confirm."
        )

    engine = create_engine(get_database_url())

    with engine.begin() as conn:
        for label, sql in STEPS:
            print(f"  → {label} ...", end=" ", flush=True)
            conn.execute(text(sql))
            print("ok")

    engine.dispose()
    print("\nMigration complete.")


if __name__ == "__main__":
    main()

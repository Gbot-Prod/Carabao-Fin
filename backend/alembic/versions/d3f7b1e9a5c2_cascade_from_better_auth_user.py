"""Deleting a BetterAuth user deletes its backend account.

- backend_users.external_auth_id -> "user"(id) ON DELETE CASCADE. Before this,
  nothing linked the two, so deleting a "user" row left its backend row behind.
- carts.user_id and merchant_applications.user_id -> ON DELETE CASCADE, so a
  buyer with a cart (or an applicant) goes too.
- merchants and transactions still block (NO ACTION): a delete in the database
  must not remove a shop or payment records. Postgres then refuses the whole
  delete; use the app's account deletion for those accounts.

Backend rows whose BetterAuth user is already gone are deleted first when
nothing blocks that, and unlinked (external_auth_id NULL) otherwise, so the new
key is valid.

Revision ID: d3f7b1e9a5c2
Revises: a9e2c4f6b8d1
Create Date: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d3f7b1e9a5c2"
down_revision: str | Sequence[str] | None = "a9e2c4f6b8d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

IDENTITY_FK = "backend_users_external_auth_id_fkey"
CHILD_TABLES = ("carts", "merchant_applications")


def _has_better_auth(bind) -> bool:
    return (
        bind.execute(sa.text("SELECT to_regclass('public.\"user\"')")).scalar()
        is not None
    )


def _fk_name(bind, table: str, column: str, target: str) -> str | None:
    return bind.execute(
        sa.text(
            """
            SELECT tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = tc.constraint_name
             AND kcu.table_schema = tc.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = :table
              AND kcu.column_name = :column
              AND ccu.table_name = :target
            """
        ),
        {"table": table, "column": column, "target": target},
    ).scalar()


def _set_child_rule(bind, table: str, rule: str) -> None:
    name = _fk_name(bind, table, "user_id", "backend_users")
    if name:
        op.drop_constraint(name, table, type_="foreignkey")
    op.create_foreign_key(
        f"{table}_user_id_fkey",
        table,
        "backend_users",
        ["user_id"],
        ["id"],
        ondelete=rule,
    )


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or not _has_better_auth(bind):
        return

    for table in CHILD_TABLES:
        _set_child_rule(bind, table, "CASCADE")

    orphan = (
        "external_auth_id IS NOT NULL "
        'AND external_auth_id NOT IN (SELECT id FROM "user")'
    )
    kept = (
        "EXISTS (SELECT 1 FROM merchants m WHERE m.user_id = backend_users.id) "
        "OR EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = backend_users.id)"
    )
    op.execute(f"DELETE FROM backend_users WHERE {orphan} AND NOT ({kept})")
    op.execute(f"UPDATE backend_users SET external_auth_id = NULL WHERE {orphan}")

    if not _fk_name(bind, "backend_users", "external_auth_id", "user"):
        op.create_foreign_key(
            IDENTITY_FK,
            "backend_users",
            "user",
            ["external_auth_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or not _has_better_auth(bind):
        return
    name = _fk_name(bind, "backend_users", "external_auth_id", "user")
    if name:
        op.drop_constraint(name, "backend_users", type_="foreignkey")
    for table in CHILD_TABLES:
        _set_child_rule(bind, table, "NO ACTION")

"""BetterAuth as the only source of identity; phone-number signup.

backend_users keeps profile data only. Name, email, phone, admin role and
suspension are read from BetterAuth's "user" table (app/models/auth_identity.py),
so their copies here are dropped. No data is carried over: the database was
wiped before this change, and BetterAuth already holds every value.

On the BetterAuth side the phoneNumber plugin needs "phoneNumberVerified" and a
unique "phoneNumber". BetterAuth's own migration (npm run auth:migrate:apply)
adds missing columns but not the constraint on an existing column, so both are
done here too, IF NOT EXISTS, and skipped without the BetterAuth tables.

Downgrade brings the columns back empty.

Revision ID: c3e8a1f5d7b9
Revises: a3d7f2c9e1b5
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c3e8a1f5d7b9"
down_revision: str | Sequence[str] | None = "a3d7f2c9e1b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _has_better_auth(bind) -> bool:
    return (
        bind.execute(sa.text("SELECT to_regclass('public.\"user\"')")).scalar()
        is not None
    )


def upgrade() -> None:
    # Indexes on these columns (including ix_backend_users_email_lower) and the
    # suspended_by foreign key go with them.
    op.drop_constraint(
        "fk_backend_users_suspended_by", "backend_users", type_="foreignkey"
    )
    for column in (
        "suspended_by",
        "suspension_reason",
        "suspended_at",
        "is_admin",
        "phone_number",
        "email",
        "name",
    ):
        op.drop_column("backend_users", column)

    bind = op.get_bind()
    if bind.dialect.name != "postgresql" or not _has_better_auth(bind):
        return
    op.execute(
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phoneNumberVerified" boolean'
    )
    op.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS "user_phoneNumber_key" '
        'ON "user" ("phoneNumber")'
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql" and _has_better_auth(bind):
        op.execute('DROP INDEX IF EXISTS "user_phoneNumber_key"')

    op.add_column("backend_users", sa.Column("name", sa.String(), nullable=True))
    op.add_column("backend_users", sa.Column("email", sa.String(), nullable=True))
    op.add_column(
        "backend_users", sa.Column("phone_number", sa.String(), nullable=True)
    )
    op.add_column(
        "backend_users",
        sa.Column(
            "is_admin", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.add_column(
        "backend_users",
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "backend_users", sa.Column("suspension_reason", sa.Text(), nullable=True)
    )
    op.add_column(
        "backend_users", sa.Column("suspended_by", sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        "fk_backend_users_suspended_by",
        "backend_users",
        "backend_users",
        ["suspended_by"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_backend_users_name", "backend_users", ["name"])
    op.create_index("ix_backend_users_email", "backend_users", ["email"], unique=True)
    op.create_index(
        "ix_backend_users_phone_number", "backend_users", ["phone_number"], unique=True
    )
    op.create_index("ix_backend_users_suspended_at", "backend_users", ["suspended_at"])
    op.create_index(
        "ix_backend_users_email_lower",
        "backend_users",
        [sa.text("lower(email)")],
        unique=True,
    )

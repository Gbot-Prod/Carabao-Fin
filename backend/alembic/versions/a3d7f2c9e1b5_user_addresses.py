"""Move the user's address out of backend_users into user_addresses.

A user can now save many addresses, one of them the default. Each user with
any address field set gets one default row copied from backend_users, then the
columns are dropped. Downgrade copies each user's default back.

Revision ID: a3d7f2c9e1b5
Revises: f1a5c9e3b7d4
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3d7f2c9e1b5"
down_revision: str | Sequence[str] | None = "f1a5c9e3b7d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ADDRESS_COLUMNS = (
    "region",
    "province",
    "city",
    "barangay",
    "address",
    "postal_code",
)


def upgrade() -> None:
    op.create_table(
        "user_addresses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("backend_users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(), nullable=True),
        *(sa.Column(c, sa.String(), nullable=True) for c in ADDRESS_COLUMNS),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column(
            "is_default", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_user_addresses_id", "user_addresses", ["id"])
    op.create_index("ix_user_addresses_user_id", "user_addresses", ["user_id"])
    op.create_index(
        "uq_user_addresses_one_default",
        "user_addresses",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )

    cols = ", ".join((*ADDRESS_COLUMNS, "lat", "lng"))
    any_set = " OR ".join(f"{c} IS NOT NULL" for c in (*ADDRESS_COLUMNS, "lat"))
    op.execute(
        f"""
        INSERT INTO user_addresses (user_id, label, {cols}, is_default)
        SELECT id, 'Home', {cols}, TRUE
        FROM backend_users
        WHERE {any_set}
        """
    )

    # Dropping a column drops its index too; named here for clarity.
    for c in ADDRESS_COLUMNS:
        op.drop_index(
            f"ix_backend_users_{c}", table_name="backend_users", if_exists=True
        )
    for c in (*ADDRESS_COLUMNS, "lat", "lng"):
        op.drop_column("backend_users", c)


def downgrade() -> None:
    for c in ADDRESS_COLUMNS:
        op.add_column("backend_users", sa.Column(c, sa.String(), nullable=True))
        op.create_index(f"ix_backend_users_{c}", "backend_users", [c])
    op.add_column("backend_users", sa.Column("lat", sa.Float(), nullable=True))
    op.add_column("backend_users", sa.Column("lng", sa.Float(), nullable=True))

    sets = ", ".join(f"{c} = a.{c}" for c in (*ADDRESS_COLUMNS, "lat", "lng"))
    op.execute(
        f"""
        UPDATE backend_users AS u SET {sets}
        FROM user_addresses AS a
        WHERE a.user_id = u.id AND a.is_default
        """
    )

    op.drop_table("user_addresses")

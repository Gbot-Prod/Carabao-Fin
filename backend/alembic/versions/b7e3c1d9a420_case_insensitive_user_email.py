"""Make backend_users.email case-insensitively unique.

Revision ID: b7e3c1d9a420
Revises: 9d4e7f2a6c31
Create Date: 2026-10-29

Emails are compared lower-cased by /auth/sync (Better Auth stores them that
way), so two rows differing only by case would be ambiguous. Existing rows are
lower-cased, and the migration stops if that would merge two accounts.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b7e3c1d9a420"
down_revision: str | Sequence[str] | None = "9d4e7f2a6c31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Lower-case stored emails and add a unique index on lower(email)."""
    bind = op.get_bind()
    duplicates = bind.execute(
        sa.text(
            """
            SELECT lower(trim(email)) AS email, array_agg(id ORDER BY id) AS ids
            FROM backend_users
            GROUP BY lower(trim(email))
            HAVING count(*) > 1
            """
        )
    ).all()
    if duplicates:
        listing = "; ".join(f"{row.email}: ids {list(row.ids)}" for row in duplicates)
        raise RuntimeError(
            "backend_users has emails that differ only by case or whitespace. "
            f"Merge or remove them before upgrading: {listing}"
        )

    op.execute("UPDATE backend_users SET email = lower(trim(email))")
    op.create_index(
        "ix_backend_users_email_lower",
        "backend_users",
        [sa.text("lower(email)")],
        unique=True,
    )


def downgrade() -> None:
    """Drop the case-insensitive index (lower-cased values are kept)."""
    op.drop_index("ix_backend_users_email_lower", table_name="backend_users")

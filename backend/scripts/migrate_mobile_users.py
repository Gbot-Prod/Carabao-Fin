"""Give app-only accounts a BetterAuth identity (single identity provider, phase 5).

Accounts created by the old /auth/mobile/sign-up have external_auth_id
"mobile:<uuid>" and no BetterAuth user, so they can't sign in any more. For each:

- If BetterAuth already has a user with that email and it is verified (the person
  registered on the website too), the backend row is linked to it. They sign in
  with their website password.
- If BetterAuth has the email but it is unverified, the row is listed for review
  and left alone: neither side has proved it owns the address.
- Otherwise a BetterAuth user is created with no password. They set one with
  "Forgot password" (web or app); the reset link also verifies the email
  (onPasswordReset in lib/auth.ts). Their old app password is not carried over.

Suspended accounts are created banned, matching app/services/account_suspension.py.

Dry run by default. Pass --apply to write; it runs in one transaction.
Run the b7e2d4f6a8c1 migration (alembic upgrade head) first.
"""

import argparse
import os
import secrets
import string
import sys
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database_url import normalize_database_url  # noqa: E402

_ID_ALPHABET = string.ascii_letters + string.digits


def better_auth_id() -> str:
    """Same shape as BetterAuth's generateId: 32 random alphanumerics."""
    return "".join(secrets.choice(_ID_ALPHABET) for _ in range(32))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Actually write.")
    args = parser.parse_args()

    load_dotenv(BACKEND_ROOT / ".env")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is not set.")
    database_url = normalize_database_url(database_url)
    url = make_url(database_url)
    print(f"Target: {url.host}:{url.port or 5432}/{url.database}")
    print("Mode:   " + ("APPLY" if args.apply else "dry run (pass --apply to write)"))
    print()

    engine = create_engine(database_url)
    with engine.begin() as conn:
        if conn.execute(text("SELECT to_regclass('public.\"user\"')")).scalar() is None:
            raise SystemExit('No BetterAuth "user" table in this database.')

        rows = (
            conn.execute(
                text(
                    """
                SELECT id, email, name, phone_number,
                       is_admin, suspended_at, suspension_reason
                FROM backend_users
                WHERE external_auth_id LIKE 'mobile:%'
                ORDER BY id
                """
                )
            )
            .mappings()
            .all()
        )

        created, linked, review = [], [], []
        now = datetime.now(UTC)
        for row in rows:
            email = row["email"].strip().lower()
            existing = (
                conn.execute(
                    text(
                        'SELECT id, "emailVerified" FROM "user" '
                        "WHERE lower(email) = :email"
                    ),
                    {"email": email},
                )
                .mappings()
                .first()
            )

            if existing is not None:
                if not existing["emailVerified"]:
                    review.append((row["id"], email))
                    continue
                linked.append((row["id"], email))
                if args.apply:
                    conn.execute(
                        text(
                            "UPDATE backend_users SET external_auth_id = :ba "
                            "WHERE id = :id"
                        ),
                        {"ba": existing["id"], "id": row["id"]},
                    )
                continue

            ba_id = better_auth_id()
            name = row["name"] or email.split("@")[0]
            created.append((row["id"], email))
            if args.apply:
                conn.execute(
                    text(
                        """
                        INSERT INTO "user" (
                            id, name, email, "emailVerified", "createdAt",
                            "updatedAt", role, banned, "banReason", "phoneNumber"
                        ) VALUES (
                            :id, :name, :email, false, :now, :now, :role,
                            :banned, :reason, :phone
                        )
                        """
                    ),
                    {
                        "id": ba_id,
                        "name": name,
                        "email": email,
                        "now": now,
                        "role": "admin" if row["is_admin"] else "user",
                        "banned": row["suspended_at"] is not None,
                        "reason": row["suspension_reason"],
                        "phone": row["phone_number"],
                    },
                )
                conn.execute(
                    text(
                        "UPDATE backend_users SET external_auth_id = :ba WHERE id = :id"
                    ),
                    {"ba": ba_id, "id": row["id"]},
                )

        def show(title: str, items: list[tuple[int, str]]) -> None:
            print(f"{title}: {len(items)}")
            for user_id, email in items:
                print(f"  backend_users.id={user_id:<6} {email}")

        show("Create BetterAuth user (must use Forgot password)", created)
        show("Link to existing verified BetterAuth user", linked)
        show("Left alone, needs review (BetterAuth email unverified)", review)

        leftovers = conn.execute(
            text("SELECT to_regclass('public.mobile_credentials')")
        ).scalar()
        if leftovers is not None:
            print("\nmobile_credentials still exists: run `alembic upgrade head`.")

        if not args.apply:
            print("\nDry run: nothing written.")


if __name__ == "__main__":
    main()

"""Empty every table in the public schema except user/auth tables.

Dry run by default: prints what would be wiped and row counts. Pass --yes to
actually truncate. Runs in a single transaction, so any failure rolls back.

No CASCADE is used on purpose: if a kept table still references a wiped one,
Postgres refuses the TRUNCATE instead of silently emptying the kept table.
"""

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database_url import normalize_database_url  # noqa: E402

# Users and their login data (FastAPI + Better Auth). Everything else is wiped.
KEEP_TABLES = {
    "backend_users",
    "mobile_credentials",
    "user",
    "session",
    "account",
    "verification",
    "twoFactor",
    "alembic_version",
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="Actually wipe.")
    parser.add_argument(
        "--keep",
        action="append",
        default=[],
        help="Extra table to keep (repeatable), e.g. --keep reference_prices",
    )
    args = parser.parse_args()

    load_dotenv(BACKEND_ROOT / ".env")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is not set.")
    database_url = normalize_database_url(database_url)
    url = make_url(database_url)
    print(f"Target: {url.host}:{url.port or 5432}/{url.database}\n")

    keep = KEEP_TABLES | set(args.keep)
    engine = create_engine(database_url)

    with engine.begin() as conn:
        tables = conn.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public' ORDER BY tablename"
            )
        ).scalars().all()

        wipe = [t for t in tables if t not in keep]
        kept = [t for t in tables if t in keep]

        def count(t: str) -> int:
            return conn.execute(text(f'SELECT count(*) FROM public."{t}"')).scalar()

        print("KEEP:")
        for t in kept:
            print(f"  {t:<28} {count(t):>8} rows")
        print("\nWIPE:")
        for t in wipe:
            print(f"  {t:<28} {count(t):>8} rows")

        if not wipe:
            print("\nNothing to wipe.")
            return
        if not args.yes:
            print("\nDry run only. Re-run with --yes to wipe the tables above.")
            return

        quoted = ", ".join(f'public."{t}"' for t in wipe)
        conn.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY"))
        print(f"\nWiped {len(wipe)} tables.")

    engine.dispose()


if __name__ == "__main__":
    main()

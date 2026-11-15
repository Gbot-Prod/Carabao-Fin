"""Empty every table in the public schema. The schema (tables, columns,
indexes, constraints) stays. This includes users and Better Auth tables.

Dry run by default: prints the target and row counts. To wipe, pass --yes and
--confirm <database name> (the name printed as "Target"). Runs in a single
transaction, so any failure rolls back. Safe to re-run.

    uv run python scripts/truncate_db.py
    uv run python scripts/truncate_db.py --yes --confirm railway
"""

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import make_url

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database_url import create_db_engine, normalize_database_url  # noqa: E402

# Schema bookkeeping, not data.
ALWAYS_KEEP = {"alembic_version"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", action="store_true", help="Actually wipe.")
    parser.add_argument("--confirm", help="Database name; must match the target.")
    parser.add_argument(
        "--keep",
        action="append",
        default=[],
        help="Table to keep (repeatable), e.g. --keep reference_prices",
    )
    args = parser.parse_args()

    load_dotenv(BACKEND_ROOT / ".env")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is not set.")
    database_url = normalize_database_url(database_url)
    url = make_url(database_url)
    print(f"Target: {url.host}:{url.port or 5432}/{url.database}\n")

    keep = ALWAYS_KEEP | set(args.keep)
    engine = create_db_engine(database_url)

    try:
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

            if kept:
                print("KEEP:")
                for t in kept:
                    print(f"  {t:<28} {count(t):>8} rows")
                print()
            print("WIPE:")
            for t in wipe:
                print(f"  {t:<28} {count(t):>8} rows")

            if not wipe:
                print("\nNothing to wipe.")
                return
            if not args.yes:
                print(
                    f"\nDry run only. Re-run with --yes --confirm {url.database} "
                    "to wipe the tables above."
                )
                return
            if args.confirm != url.database:
                raise SystemExit(
                    f"\n--confirm must be '{url.database}'. Nothing was wiped."
                )

            # Every table in the set is truncated together, so CASCADE only
            # matters for tables passed with --keep that reference wiped ones.
            # Without it, Postgres refuses instead of emptying a kept table.
            quoted = ", ".join(f'public."{t}"' for t in wipe)
            conn.execute(text(f"TRUNCATE {quoted} RESTART IDENTITY"))
            print(f"\nWiped {len(wipe)} tables.")
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()

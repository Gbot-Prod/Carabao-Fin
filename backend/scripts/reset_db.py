import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


# Ensure all models are registered in metadata before create_all.
from app.models import cart, merchant, produce, shopPage, user  # noqa: F401
from app.core.database import Base


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reset PostgreSQL schema and recreate FastAPI tables."
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm destructive reset.",
    )
    parser.add_argument(
        "--skip-create",
        action="store_true",
        help="Only drop schema and do not recreate FastAPI tables.",
    )
    return parser.parse_args()


def get_database_url() -> str:
    load_dotenv()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set.")
    return database_url


def reset_public_schema(database_url: str) -> None:
    admin_engine = create_engine(database_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
        conn.execute(text("GRANT ALL ON SCHEMA public TO public"))
    admin_engine.dispose()


def create_fastapi_tables(database_url: str) -> None:
    app_engine = create_engine(database_url)
    Base.metadata.create_all(bind=app_engine)
    app_engine.dispose()


def main() -> None:
    args = parse_args()

    if not args.yes:
        raise SystemExit(
            "Refusing to reset without confirmation. Re-run with --yes."
        )

    database_url = get_database_url()
    reset_public_schema(database_url)

    if not args.skip_create:
        create_fastapi_tables(database_url)

    print("Database reset complete.")


if __name__ == "__main__":
    main()

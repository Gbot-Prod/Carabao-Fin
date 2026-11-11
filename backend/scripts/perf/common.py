"""Paths, seeded accounts and the database guard shared by the SOP 3 scripts."""

import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
RESULTS_ROOT = BACKEND_ROOT / "scripts" / "results" / "perf"

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

LOCAL_PERF_PORT = 55432
DEFAULT_PERF_DATABASE_URL = (
    f"postgresql+psycopg://postgres@127.0.0.1:{LOCAL_PERF_PORT}/carabao_perf"
)

# Seeded accounts only exist in the throwaway perf database.
PERF_PASSWORD = "PerfTest!2026"


def buyer_email(index: int) -> str:
    return f"perf-buyer-{index:04d}@example.com"


def merchant_email(index: int) -> str:
    return f"perf-merchant-{index:04d}@example.com"


def perf_database_url() -> str:
    """Return the perf database URL, refusing anything that could be real data.

    The app's .env points at the deployed database, so every script that seeds,
    resets or serves goes through this check first.
    """
    from dotenv import dotenv_values
    from sqlalchemy.engine import make_url

    from app.core.database_url import normalize_database_url

    raw = os.getenv("PERF_DATABASE_URL", DEFAULT_PERF_DATABASE_URL)
    url = make_url(normalize_database_url(raw))
    if "perf" not in (url.database or ""):
        raise SystemExit(
            f"Refusing database {url.database!r} on {url.host}: the name must "
            "contain 'perf'. These scripts truncate and reseed their target."
        )

    app_url = dotenv_values(BACKEND_ROOT / ".env").get("DATABASE_URL")
    if app_url:
        app = make_url(normalize_database_url(app_url))
        if (app.host, app.port, app.database) == (url.host, url.port, url.database):
            raise SystemExit("PERF_DATABASE_URL is the same as the app's DATABASE_URL.")
    return url.render_as_string(hide_password=False)


def use_perf_database() -> None:
    """Point app.core.database at the perf database. Call before importing app.*."""
    from dotenv import load_dotenv

    load_dotenv(BACKEND_ROOT / ".env")
    os.environ["DATABASE_URL"] = perf_database_url()

"""Load the PSGC lists into psgc_areas (replaces every row).

    uv run python scripts/load_psgc.py [path/to/psgc.csv]

Without a path it loads app/data/psgc.csv (made by scripts/fetch_psgc.py). Run
it once after `alembic upgrade head` on a new database, and again after the
file changes. Until it runs, address saves answer 503.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
load_dotenv(BACKEND_ROOT / ".env")

from app.core.database import SessionLocal  # noqa: E402
from app.services.psgc import SEED_FILE, load  # noqa: E402


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else SEED_FILE
    with SessionLocal() as db:
        count = load(db, path)
    print(f"Loaded {count} PSGC places from {path}")


if __name__ == "__main__":
    main()

"""Load the PSGC boundary polygons into psgc_boundaries (replaces every row).

    uv run python scripts/load_psgc_boundaries.py [path/to/psgc_boundaries.jsonl.gz]

Without a path it loads app/data/psgc_boundaries.jsonl.gz (made by
scripts/fetch_psgc_boundaries.py). Run it once after `alembic upgrade head` on a
new database, and again after the file changes. Until it runs, the pin-area
check does not run: saves still work and pin_area_mismatch stays NULL.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
load_dotenv(BACKEND_ROOT / ".env")

from app.core.database import SessionLocal  # noqa: E402
from app.services.pin_area import SEED_FILE, load  # noqa: E402


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else SEED_FILE
    with SessionLocal() as db:
        count = load(db, path)
    print(f"Loaded {count} boundary polygons from {path}")


if __name__ == "__main__":
    main()

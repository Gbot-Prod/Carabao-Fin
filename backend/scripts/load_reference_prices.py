"""Load reference prices from a CSV into the database (P1).

    uv run python scripts/load_reference_prices.py [path/to/file.csv]

Without a path it loads app/data/reference_prices.csv, which holds SAMPLE
placeholder rows only. Replace them with DA Bantay Presyo data before a pilot.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
load_dotenv(BACKEND_ROOT / ".env")

from app.core.database import SessionLocal  # noqa: E402
from app.services.reference_prices import SEED_FILE, load  # noqa: E402


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else SEED_FILE
    with SessionLocal() as db:
        count = load(db, path)
    print(f"Loaded {count} reference prices from {path}")


if __name__ == "__main__":
    main()

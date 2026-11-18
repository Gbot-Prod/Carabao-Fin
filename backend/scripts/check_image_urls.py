"""List stored image URLs that are not in our R2 bucket (CF-0057, B31).

Report only: prints one line per URL and changes nothing. Exit code 1 when
any are found, so it can run in a check.

    uv run python scripts/check_image_urls.py

Compares with CLOUDFLARE_R2_PUBLIC_URL from the environment / .env.
"""

import importlib
import os
import pkgutil
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import app.models as models_pkg  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.services.image_audit import find_offsite_images  # noqa: E402

# Every model, so relationships by name resolve.
for _module in pkgutil.iter_modules(models_pkg.__path__):
    importlib.import_module(f"app.models.{_module.name}")


def main() -> int:
    public_url = os.getenv("CLOUDFLARE_R2_PUBLIC_URL", "")
    db = SessionLocal()
    try:
        found = find_offsite_images(db, public_url)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 2
    finally:
        db.close()
    for item in found:
        print(f"{item.table}\t{item.row_id}\t{item.column}\t{item.url}")
    print(
        f"{len(found)} image URL(s) outside {public_url.rstrip('/')}", file=sys.stderr
    )
    return 1 if found else 0


if __name__ == "__main__":
    raise SystemExit(main())

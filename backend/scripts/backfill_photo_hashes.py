"""Fill produces.image_phash for photos uploaded before guardrails Phase 4.

    uv run python scripts/backfill_photo_hashes.py [--dry-run]

Only photos in our R2 bucket (CLOUDFLARE_R2_PUBLIC_URL) are downloaded. A
photo with a QR code is reported, not changed: an admin decides. The
stolen-photo flag uses the hashes on the next check of each listing.
"""

import argparse
import importlib
import pkgutil
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
load_dotenv(BACKEND_ROOT / ".env")

import app.models as models_pkg  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.models.produce import Produce  # noqa: E402
from app.services import listing_vision, photo_checks  # noqa: E402

# Produce -> Merchant -> ... needs every mapper, as in sync_da_prices.py.
for _module in pkgutil.iter_modules(models_pkg.__path__):
    importlib.import_module(f"{models_pkg.__name__}.{_module.name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    done = skipped = qr = 0
    with SessionLocal() as db:
        rows = (
            db.query(Produce)
            .filter(Produce.image_url.isnot(None), Produce.image_phash.is_(None))
            .order_by(Produce.id)
            .all()
        )
        for produce in rows:
            try:
                data, _ = listing_vision._download(produce.image_url)
                facts = photo_checks.inspect(data)
            except Exception as exc:  # one bad photo must not stop the run
                skipped += 1
                print(f"listing {produce.id}: skipped ({exc})")
                continue
            if facts.has_qr_code:
                qr += 1
                print(f"listing {produce.id}: photo has a QR code, check it")
            produce.image_phash = facts.phash
            done += 1
        if args.dry_run:
            db.rollback()
        else:
            db.commit()
    verb = "would hash" if args.dry_run else "hashed"
    print(f"{verb} {done}, skipped {skipped}, with a QR code {qr}")


if __name__ == "__main__":
    main()

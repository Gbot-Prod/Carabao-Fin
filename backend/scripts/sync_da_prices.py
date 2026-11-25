"""Sync reference prices from the DA Price Index API (guardrails Phase 4).

    uv run python scripts/sync_da_prices.py [REGION]

The API runs the same sync by itself every ``DA_PRICE_SYNC_HOURS`` (main.py
background loop). Use this script to sync now, for example after a change to
``app/data/inhouse_reference_prices.csv``. ``DA_PRICE_API_URL`` sets the API
(the default is in ``app.services.da_price_sync``). Exit code 1 when the API
fails or the report has too few produce prices; the old rows then stay.
"""

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
from app.services import audit_log, da_price_sync  # noqa: E402

# The audit row needs every mapper (User -> Merchant ...), as in make_admin.py.
for _module in pkgutil.iter_modules(models_pkg.__path__):
    importlib.import_module(f"{models_pkg.__name__}.{_module.name}")


def main() -> int:
    region = sys.argv[1] if len(sys.argv) > 1 else da_price_sync.DEFAULT_REGION
    with SessionLocal() as db:
        try:
            result = da_price_sync.sync(db, region=region, commit=False)
        except (
            da_price_sync.DaPriceSyncError,
            da_price_sync.reference_prices.ReferencePriceFileError,
        ) as exc:
            db.rollback()
            print(f"DA price sync failed: {exc}", file=sys.stderr)
            return 1
        audit_log.record_system_action(
            db,
            action=audit_log.REFERENCE_PRICES_SYNC,
            target_type="reference_prices",
            target_id=None,
            after=da_price_sync.sync_summary(result),
        )
        db.commit()
    print(
        f"Synced {result.groups} produce prices for {result.region} "
        f"(as of {result.as_of}) and {result.inhouse} in-house prices "
        f"(left out, DA has them: {result.inhouse_overlap}); "
        f"kept {result.rows_kept} admin rows; "
        f"skipped {result.skipped_unavailable} unavailable, "
        f"{result.skipped_drift} drift flagged, "
        f"{len(result.skipped_unit)} not per kg {result.skipped_unit}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

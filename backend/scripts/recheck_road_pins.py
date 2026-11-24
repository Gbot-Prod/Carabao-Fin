"""Check the road again for pins saved while the road service was down.

    uv run python scripts/recheck_road_pins.py [--limit N]

A pin saved during a road-service outage is accepted without a road point
(fail open, services/road_snap.py). Such a pin has lat/lng but no road_lat.
This script finds them on saved addresses, merchants, merchant applications
and open orders, and runs the road check again:

* a road found  -> its point is stored; routing and the rider use it;
* no road near  -> nothing changes here. The row id is printed. The pin is
  refused on its next save or checkout, and the rider sees a warning on the
  stop if the order ships first;
* no answer     -> the service is still down; run the script again later.

Checkout and shipment creation do the same check for the pins they use, so
this script is only a sweep. Output holds row ids, never coordinates (CF-0059).
"""

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
load_dotenv(BACKEND_ROOT / ".env")

from app.core.database import SessionLocal  # noqa: E402
from app.models.merchant import Merchant  # noqa: E402
from app.models.merchant_application import MerchantApplication  # noqa: E402
from app.models.order import Order  # noqa: E402
from app.models.user_address import UserAddress  # noqa: E402
from app.services import road_snap  # noqa: E402
from app.services.order_status import ACTIVE_ORDER_STATUSES  # noqa: E402
from app.services.pinned_location import recheck_roads  # noqa: E402

# (model, column prefix, extra filters)
TABLES = (
    (UserAddress, "", ()),
    (Merchant, "", ()),
    (MerchantApplication, "", ()),
    (Order, "delivery_", (Order.status.in_(ACTIVE_ORDER_STATUSES),)),
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--limit", type=int, default=500, help="rows per table")
    args = parser.parse_args()

    if road_snap.provider() == "off":
        print("ROAD_SNAP_PROVIDER is off (or no Mapbox token): nothing to check.")
        return

    with SessionLocal() as db:
        for model, prefix, filters in TABLES:
            rows = (
                db.query(model)
                .filter(
                    getattr(model, f"{prefix}lat").is_not(None),
                    getattr(model, f"{prefix}lng").is_not(None),
                    getattr(model, f"{prefix}road_lat").is_(None),
                    *filters,
                )
                .order_by(model.id)
                .limit(args.limit)
                .all()
            )
            results = recheck_roads([(row, prefix) for row in rows])
            fixed = sum(isinstance(r, road_snap.Snap) for r in results)
            no_road = [
                row.id
                for row, r in zip(rows, results, strict=True)
                if r is road_snap.NO_ROAD
            ]
            waiting = len(rows) - fixed - len(no_road)
            db.commit()
            print(
                f"{model.__tablename__}: {len(rows)} unchecked, {fixed} road found, "
                f"{len(no_road)} no road, {waiting} no answer"
            )
            if no_road:
                print(f"  no road near the pin, ids: {', '.join(map(str, no_road))}")


if __name__ == "__main__":
    main()

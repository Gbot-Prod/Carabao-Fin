"""Map-pinned coordinates (U1).

Buyers and merchants can drop a pin on a map; the point is stored with the
address. Routing uses a stored point and only geocodes the address text when
there is none, which is both more accurate (a pin is where the gate is) and
saves a geocoding request.

Pin quality:
* control 1: a pin must have a drivable road within ``road_snap.max_meters()``;
* control 2: the point on that road is stored next to the pin (``road_lat`` /
  ``road_lng``). The buyer sees their own pin; routing and the rider use the
  road point, so no engine moves the pin without a check;
* confirmed: the web forms place the first pin from the typed address, so a
  pin is only exact once the person placed or moved it (``pin_confirmed``).
  Riders see an unconfirmed pin as approximate;
* control 6: a rider (the merchant) can report that a stop's pin could not be
  reached. After ``PIN_FLAG_LIMIT`` reports near the same place, that place
  can no longer be used for new orders until the buyer moves the pin.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.services import road_snap
from app.services.service_area import OUTSIDE_LUZON_DETAIL, in_luzon_bbox

Coords = tuple[float, float]

NO_ROAD_DETAIL = (
    "There is no road near this pin. Move the pin to your gate or to the "
    "street where the rider can stop."
)
# Control 6: reports within this distance count as the same place.
FLAG_RADIUS_M = 50.0
FLAG_WINDOW_DAYS = 90
PIN_FLAG_LIMIT = 2
FLAGGED_PIN_DETAIL = (
    "Riders could not get to this pin on earlier orders. Move the pin to a gate "
    "or road that a rider can get to."
)


class PinCheck(NamedTuple):
    pin: Coords
    # The nearest road point, or None when the road check did not run.
    road: Coords | None


def _check_coords(lat: float | None, lng: float | None) -> Coords | None:
    if lat is None and lng is None:
        return None
    if lat is None or lng is None:
        raise HTTPException(
            status_code=422, detail="Send both latitude and longitude for a pin"
        )
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(status_code=422, detail="That pin is not a valid location")
    if not in_luzon_bbox(lat, lng):
        raise HTTPException(status_code=400, detail=OUTSIDE_LUZON_DETAIL)
    return (lat, lng)


def validate_pin(lat: float | None, lng: float | None) -> PinCheck | None:
    """Both or neither; inside the Luzon box; a road near it.

    Returns the pin and its road point, or None for no pin. A road service
    outage accepts the pin without a road point (see road_snap).
    """
    pin = _check_coords(lat, lng)
    if pin is None:
        return None
    snap = road_snap.snap_to_road(*pin)
    if snap is road_snap.NO_ROAD:
        raise HTTPException(status_code=422, detail=NO_ROAD_DETAIL)
    road = snap.road if isinstance(snap, road_snap.Snap) else None
    return PinCheck(pin=pin, road=road)


def apply_pin(
    target, check: PinCheck | None, *, confirmed: bool = False, prefix: str = ""
) -> None:
    """Write a checked pin (or no pin) to a model's lat/lng, road and
    confirmed columns. No pin is never confirmed."""
    pin = check.pin if check else (None, None)
    road = check.road if check and check.road else (None, None)
    setattr(target, f"{prefix}lat", pin[0])
    setattr(target, f"{prefix}lng", pin[1])
    setattr(target, f"{prefix}road_lat", road[0])
    setattr(target, f"{prefix}road_lng", road[1])
    setattr(target, f"{prefix}pin_confirmed", bool(check and confirmed))


def pin_update(target, updates: dict) -> bool:
    """Apply a partial update's pin fields (lat, lng, pin_confirmed) to a
    model and drop them from ``updates``. Returns whether anything changed.

    A moved pin without ``pin_confirmed`` counts as unconfirmed; sending only
    ``pin_confirmed`` confirms (or unconfirms) the pin already saved.
    """
    if not {"lat", "lng", "pin_confirmed"} & updates.keys():
        return False
    moved = "lat" in updates or "lng" in updates
    confirmed = updates.pop("pin_confirmed", None)
    if confirmed is None:
        confirmed = False if moved else bool(target.pin_confirmed)
    check = validate_pin(updates.pop("lat", target.lat), updates.pop("lng", target.lng))
    apply_pin(target, check, confirmed=confirmed)
    return True


def stored(lat: float | None, lng: float | None) -> Coords | None:
    return (float(lat), float(lng)) if lat is not None and lng is not None else None


def _routing_point(obj, prefix: str = "") -> Coords | None:
    """The road point if there is one, else the pin."""
    road = stored(
        getattr(obj, f"{prefix}road_lat", None), getattr(obj, f"{prefix}road_lng", None)
    )
    return road or stored(getattr(obj, f"{prefix}lat"), getattr(obj, f"{prefix}lng"))


def merchant_point(
    merchant, address: str, geocode: Callable[[str], Coords | None]
) -> Coords | None:
    return _routing_point(merchant) or (geocode(address) if address else None)


def delivery_point(
    order,
    saved_address,
    address: str | None,
    geocode: Callable[[str], Coords | None],
) -> Coords | None:
    """The order's own pin; else the pin of the buyer's default saved address
    (a UserAddress) when the order fell back to it; else geocode the text.
    Each pin goes by its road point when it has one."""
    pin = _routing_point(order, "delivery_")
    if pin:
        return pin
    if not order.delivery_address and saved_address is not None:
        pin = _routing_point(saved_address)
        if pin:
            return pin
    return geocode(address) if address else None


def saved_pin_confirmed(saved_address, pin: Coords | None) -> bool:
    """Whether ``pin`` is a saved address's own confirmed pin. Apps that send
    an order pin without saying whether it was confirmed (mobile) send a
    saved address's pin; it keeps that address's flag."""
    if pin is None or saved_address is None or not saved_address.pin_confirmed:
        return False
    own = stored(saved_address.lat, saved_address.lng)
    return own is not None and distance_m(own, pin) < 1.0


def delivery_pin_confirmed(order, saved_address) -> bool:
    """Whether the point ``delivery_point`` routes to is a pin the buyer
    placed: the order's own pin, or the saved address pin it fell back to.
    A geocoded address is never confirmed."""
    if stored(order.delivery_lat, order.delivery_lng):
        return bool(order.delivery_pin_confirmed)
    if not order.delivery_address and saved_address is not None:
        if stored(saved_address.lat, saved_address.lng):
            return bool(saved_address.pin_confirmed)
    return False


# --- Control 6: unreachable-pin reports -------------------------------------


def distance_m(a: Coords, b: Coords) -> float:
    """Great-circle distance in metres (haversine)."""
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def flag_count_near(db: Session, user_id: int, pin: Coords) -> int:
    """How many of the buyer's recent orders near ``pin`` a rider reported."""
    from app.models.order import Order

    since = datetime.now(UTC) - timedelta(days=FLAG_WINDOW_DAYS)
    rows = (
        db.query(Order.delivery_lat, Order.delivery_lng)
        .filter(
            Order.user_id == user_id,
            Order.pin_unreachable_at.is_not(None),
            Order.pin_unreachable_at >= since,
            Order.delivery_lat.is_not(None),
            Order.delivery_lng.is_not(None),
        )
        .all()
    )
    return sum(1 for lat, lng in rows if distance_m(pin, (lat, lng)) <= FLAG_RADIUS_M)


def enforce_not_flagged(db: Session, user_id: int, pin: Coords | None) -> None:
    if pin is not None and flag_count_near(db, user_id, pin) >= PIN_FLAG_LIMIT:
        raise HTTPException(status_code=409, detail=FLAGGED_PIN_DETAIL)

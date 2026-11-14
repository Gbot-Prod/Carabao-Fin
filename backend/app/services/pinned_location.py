"""Map-pinned coordinates (U1).

Buyers and merchants can drop a pin on a map; the point is stored with the
address. Routing uses a stored point and only geocodes the address text when
there is none, which is both more accurate (a pin is where the gate is) and
saves a geocoding request.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import HTTPException

from app.services.service_area import OUTSIDE_LUZON_DETAIL, in_luzon_bbox

Coords = tuple[float, float]


def validate_pin(lat: float | None, lng: float | None) -> Coords | None:
    """Both or neither; inside the Luzon box. Returns the pair or None."""
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


def stored(lat: float | None, lng: float | None) -> Coords | None:
    return (float(lat), float(lng)) if lat is not None and lng is not None else None


def merchant_point(
    merchant, address: str, geocode: Callable[[str], Coords | None]
) -> Coords | None:
    return stored(merchant.lat, merchant.lng) or (geocode(address) if address else None)


def delivery_point(
    order,
    saved_address,
    address: str | None,
    geocode: Callable[[str], Coords | None],
) -> Coords | None:
    """The order's own pin; else the pin of the buyer's default saved address
    (a UserAddress) when the order fell back to it; else geocode the text."""
    pin = stored(order.delivery_lat, order.delivery_lng)
    if pin:
        return pin
    if not order.delivery_address and saved_address is not None:
        pin = stored(saved_address.lat, saved_address.lng)
        if pin:
            return pin
    return geocode(address) if address else None

from __future__ import annotations

import asyncio
import math
import os
import time
from urllib.parse import quote

import requests as _requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.user import User
from app.routing.service import compute_route
from app.routing.state import Stop

router = APIRouter(tags=["tracking"])

_CYCLE_SECONDS = 120

_geocode_cache: dict[str, tuple[float, float]] = {}


class TrackingPosition(BaseModel):
    lat: float
    lng: float


class Waypoint(BaseModel):
    lat: float
    lng: float
    label: str
    type: str  # "pickup" | "delivery"


class TrackingResponse(BaseModel):
    order_id: int
    waypoints: list[Waypoint]
    origin: TrackingPosition
    destination: TrackingPosition
    progress: float
    eta_minutes: int


# Bounding box for the Philippines so Mapbox never returns a result outside the country.
_PH_BBOX = "116.928,4.587,126.604,21.321"
# Proximity bias toward Metro Manila — pulls ambiguous results toward the delivery region.
_METRO_MANILA_PROXIMITY = "120.9842,14.5995"


def _normalise_address(address: str) -> str:
    """Append ', Philippines' if the address doesn't already reference the country."""
    cleaned = address.strip()
    lower = cleaned.lower()
    if "philippines" not in lower and ", ph" not in lower:
        cleaned = f"{cleaned}, Philippines"
    return cleaned


def _geocode_sync(address: str) -> tuple[float, float] | None:
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token or not address.strip():
        return None

    normalised = _normalise_address(address)
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(normalised)}.json"
    try:
        resp = _requests.get(
            url,
            params={
                "country": "PH",
                "bbox": _PH_BBOX,
                "proximity": _METRO_MANILA_PROXIMITY,
                "types": "address,poi,place,locality,neighborhood",
                "limit": 1,
                "access_token": token,
            },
            timeout=5,
        )
        if not resp.ok:
            print(f"[geocode] Mapbox error {resp.status_code} for address: {normalised!r}")
            return None

        body = resp.json()
        features = body.get("features", [])
        if not features:
            print(f"[geocode] No results for address: {normalised!r}")
            return None

        feature = features[0]
        relevance = feature.get("relevance", 1.0)
        if relevance < 0.4:
            print(f"[geocode] Low-confidence result (relevance={relevance:.2f}) for: {normalised!r} → {feature.get('place_name')}")

        lng, lat = feature["center"]
        print(f"[geocode] {normalised!r} → ({lat:.5f}, {lng:.5f})  place={feature.get('place_name')!r}  relevance={relevance:.2f}")
        return (lat, lng)
    except Exception as exc:
        print(f"[geocode] Exception for address {normalised!r}: {exc}")
        return None


async def _geocode(address: str) -> tuple[float, float] | None:
    key = address.strip().lower()
    if key in _geocode_cache:
        return _geocode_cache[key]
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, _geocode_sync, address)
    if result:
        _geocode_cache[key] = result
    return result


@router.get("/tracking/{order_id}", response_model=TrackingResponse)
async def get_order_tracking(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = (
        db.query(Order)
        .join(OrderHistory)
        .filter(Order.id == order_id, OrderHistory.user_id == current_user.id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    merchant_address = order.merchant.location if order.merchant else None
    if not merchant_address:
        raise HTTPException(status_code=422, detail="Merchant has no location set")

    delivery_address = order.delivery_address
    if not delivery_address:
        parts = [p for p in [current_user.address, current_user.city] if p]
        delivery_address = ", ".join(parts) if parts else None
    if not delivery_address:
        raise HTTPException(status_code=422, detail="No delivery address on file")

    origin_coords, dest_coords = await asyncio.gather(
        _geocode(merchant_address),
        _geocode(delivery_address),
    )

    if not origin_coords:
        raise HTTPException(status_code=422, detail=f"Could not geocode merchant address: {merchant_address!r}")
    if not dest_coords:
        raise HTTPException(status_code=422, detail=f"Could not geocode delivery address: {delivery_address!r}")

    merchant_name = order.merchant.merchant_name if order.merchant else "Merchant"

    # Use pre-computed ALNS route if available; otherwise return error (route only computed when marked for shipping)
    if order.route_waypoints:
        # Reconstruct waypoints from stored JSON
        waypoints = [
            Waypoint(
                lat=origin_coords[0],
                lng=origin_coords[1],
                label=f"Pickup: {merchant_name}",
                type="pickup",
            )
        ] + [
            Waypoint(
                lat=w["lat"],
                lng=w["lng"],
                label=w.get("label", "Your Location"),
                type=w.get("type", "delivery"),
            )
            for w in order.route_waypoints
        ]
    else:
        raise HTTPException(
            status_code=412,
            detail="Route not yet computed. Merchant must mark order for shipping first."
        )

    elapsed = time.time() % _CYCLE_SECONDS
    progress = round(elapsed / _CYCLE_SECONDS, 4)
    eta_minutes = math.ceil((1.0 - progress) * _CYCLE_SECONDS / 60)

    return TrackingResponse(
        order_id=order_id,
        waypoints=waypoints,
        origin=TrackingPosition(lat=origin_coords[0], lng=origin_coords[1]),
        destination=TrackingPosition(lat=dest_coords[0], lng=dest_coords[1]),
        progress=progress,
        eta_minutes=eta_minutes,
    )

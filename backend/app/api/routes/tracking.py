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


def _geocode_sync(address: str) -> tuple[float, float] | None:
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token or not address.strip():
        return None
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(address)}.json"
    try:
        resp = _requests.get(
            url,
            params={"country": "PH", "limit": 1, "access_token": token},
            timeout=5,
        )
        if not resp.ok:
            return None
        features = resp.json().get("features", [])
        if not features:
            return None
        lng, lat = features[0]["center"]
        return (lat, lng)
    except Exception:
        return None


async def _geocode(address: str) -> tuple[float, float] | None:
    key = address.strip().lower()
    if key in _geocode_cache:
        return _geocode_cache[key]
    loop = asyncio.get_event_loop()
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

    # Build stop list and run ALNS.
    # Depot = merchant (pickup point). Stop = customer delivery address.
    # For a single order this is trivially solved; structure is ready for batching.
    customer_stop = Stop(
        order_id=order_id,
        merchant_id=order.merchant_id or -1,
        lat=dest_coords[0],
        lng=dest_coords[1],
    )

    ordered_stops = compute_route(
        stops=[customer_stop],
        depot_lat=origin_coords[0],
        depot_lng=origin_coords[1],
    )

    merchant_name = order.merchant.merchant_name if order.merchant else "Merchant"

    waypoints = [
        Waypoint(
            lat=origin_coords[0],
            lng=origin_coords[1],
            label=f"Pickup: {merchant_name}",
            type="pickup",
        )
    ] + [
        Waypoint(
            lat=s.lat,
            lng=s.lng,
            label="Your Location",
            type="delivery",
        )
        for s in ordered_stops
    ]

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

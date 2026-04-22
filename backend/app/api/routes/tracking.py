from __future__ import annotations

import math
import time

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

# ---------------------------------------------------------------------------
# Dummy tracking route (testing only)
# ---------------------------------------------------------------------------

# Simulated delivery route: Bulacan farm → Quezon City → Makati (Manila area)
_DUMMY_WAYPOINTS = [
    (14.7942, 120.8788),  # Bulacan (origin/farm)
    (14.7500, 120.9200),
    (14.7000, 120.9800),
    (14.6700, 121.0200),
    (14.6400, 121.0500),
    (14.6200, 121.0500),
    (14.5800, 121.0400),
    (14.5500, 121.0200),
    (14.5300, 121.0100),
    (14.5100, 121.0000),
    (14.4900, 121.0100),  # Makati (destination)
]

_CYCLE_SECONDS = 120  # full route completes in 2 minutes for testing


class TrackingPosition(BaseModel):
    lat: float
    lng: float


class TrackingResponse(BaseModel):
    order_id: int
    origin: TrackingPosition
    destination: TrackingPosition
    current_position: TrackingPosition
    waypoints: list[TrackingPosition]
    progress: float
    eta_minutes: int


@router.get("/tracking/{order_id}", response_model=TrackingResponse)
async def get_dummy_tracking(order_id: int):
    elapsed = time.time() % _CYCLE_SECONDS
    progress = elapsed / _CYCLE_SECONDS  # 0.0 → 1.0

    waypoints = _DUMMY_WAYPOINTS
    total_segments = len(waypoints) - 1
    scaled = progress * total_segments
    segment_index = min(int(scaled), total_segments - 1)
    segment_progress = scaled - segment_index

    lat1, lng1 = waypoints[segment_index]
    lat2, lng2 = waypoints[segment_index + 1]
    current_lat = lat1 + (lat2 - lat1) * segment_progress
    current_lng = lng1 + (lng2 - lng1) * segment_progress

    remaining = 1.0 - progress
    eta_minutes = math.ceil(remaining * _CYCLE_SECONDS / 60)

    origin_lat, origin_lng = waypoints[0]
    dest_lat, dest_lng = waypoints[-1]

    return TrackingResponse(
        order_id=order_id,
        origin=TrackingPosition(lat=origin_lat, lng=origin_lng),
        destination=TrackingPosition(lat=dest_lat, lng=dest_lng),
        current_position=TrackingPosition(lat=current_lat, lng=current_lng),
        waypoints=[TrackingPosition(lat=lat, lng=lng) for lat, lng in waypoints],
        progress=round(progress, 4),
        eta_minutes=eta_minutes,
    )


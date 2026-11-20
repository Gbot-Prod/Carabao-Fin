"""Pin check before save (pin quality, control 5).

The map picker calls this each time the pin moves, so the person sees at once
where the rider will stop, or that there is no road near the pin. The save
routes run the same check again (validate_pin); this answer is only a preview.
"""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import User
from app.services import rate_limit
from app.services.pinned_location import (
    PIN_FLAG_LIMIT,
    distance_m,
    flag_count_near,
    validate_pin,
)

router = APIRouter(tags=["locations"])


class PinCheckRequest(BaseModel):
    lat: float
    lng: float

    model_config = ConfigDict(extra="forbid")


class PinCheckResponse(BaseModel):
    lat: float
    lng: float
    # The point on the nearest road; null when the road check did not run.
    road_lat: float | None = None
    road_lng: float | None = None
    road_distance_m: float | None = None
    # Control 6: rider reports near this pin on the person's own orders.
    unreachable_reports: int = 0
    # True when checkout will refuse this pin (too many reports).
    blocked: bool = False


@router.post("/locations/pin-check", response_model=PinCheckResponse)
def check_pin(
    payload: PinCheckRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "pin_check", str(current_user.id))
    # Raises 400 (outside Luzon) or 422 (no road near the pin).
    check = validate_pin(payload.lat, payload.lng)
    assert check is not None
    reports = flag_count_near(db, cast(int, current_user.id), check.pin)
    road = check.road
    return PinCheckResponse(
        lat=check.pin[0],
        lng=check.pin[1],
        road_lat=road[0] if road else None,
        road_lng=road[1] if road else None,
        road_distance_m=round(distance_m(check.pin, road), 1) if road else None,
        unreachable_reports=reports,
        blocked=reports >= PIN_FLAG_LIMIT,
    )

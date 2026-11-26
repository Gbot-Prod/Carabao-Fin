"""Map pin picker endpoints.

Pin check before save (pin quality, control 5): the map picker calls this each
time the pin moves, so the person sees at once where the rider will stop, or
that there is no road near the pin. The save routes run the same check again
(validate_pin); this answer is only a preview.

Place search: forward and reverse geocoding for the picker, so the Mapbox
geocoding token stays on the server (services/place_search).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, cast

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import User
from app.services import place_search, rate_limit
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
    # Merchant pickup pins: refuse (503) when the road check did not run.
    strict: bool = False

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
    # Raises 400 (outside Luzon), 422 (no road near the pin), or with
    # ``strict`` 503 (the road check did not run).
    check = validate_pin(payload.lat, payload.lng, strict=payload.strict)
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


# --- Place search for the pin picker (server-side Mapbox geocoding) ----------


class GeocodeRequest(BaseModel):
    query: str = Field(min_length=1, max_length=place_search.MAX_QUERY_LENGTH)

    model_config = ConfigDict(extra="forbid")


class ReverseGeocodeRequest(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)

    model_config = ConfigDict(extra="forbid")


class PlaceContext(BaseModel):
    id: str
    text: str


class PlaceFeature(BaseModel):
    id: str | None = None
    place_type: list[str] = []
    text: str | None = None
    place_name: str | None = None
    center: list[float]
    context: list[PlaceContext] = []


class PlaceResponse(BaseModel):
    # Null: Mapbox found nothing.
    feature: PlaceFeature | None = None


def _place(lookup: Callable[[], dict[str, Any] | None]) -> PlaceResponse:
    try:
        found = lookup()
    except place_search.PlaceSearchUnavailable:
        raise HTTPException(
            status_code=503, detail="Place search is unavailable right now."
        ) from None
    return PlaceResponse(feature=PlaceFeature(**found) if found else None)


@router.post("/locations/geocode", response_model=PlaceResponse)
def geocode(
    payload: GeocodeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "place_search", str(current_user.id))
    return _place(lambda: place_search.forward(payload.query))


# Street suggestions (dropdown under the street field in the address forms).
_SESSION = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class SuggestRequest(BaseModel):
    query: str = Field(min_length=1, max_length=place_search.MAX_QUERY_LENGTH)
    # Groups the typing and the pick into one Google billing session.
    session: str | None = _SESSION

    model_config = ConfigDict(extra="forbid")


class PlaceSuggestion(BaseModel):
    id: str
    title: str
    subtitle: str = ""
    # [lng, lat]; null: ask /locations/place for the coordinates.
    center: list[float] | None = None


class SuggestResponse(BaseModel):
    suggestions: list[PlaceSuggestion] = []


class PlaceRequest(BaseModel):
    id: str = Field(min_length=1, max_length=512, pattern=r"^[A-Za-z0-9_-]+$")
    session: str | None = _SESSION

    model_config = ConfigDict(extra="forbid")


@router.post("/locations/suggest", response_model=SuggestResponse)
def suggest(
    payload: SuggestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "place_suggest", str(current_user.id))
    try:
        found = place_search.suggest(payload.query, payload.session)
    except place_search.PlaceSearchUnavailable:
        raise HTTPException(
            status_code=503, detail="Place search is unavailable right now."
        ) from None
    return SuggestResponse(suggestions=[PlaceSuggestion(**s) for s in found])


@router.post("/locations/place", response_model=PlaceResponse)
def place(
    payload: PlaceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "place_search", str(current_user.id))
    return _place(lambda: place_search.place(payload.id, payload.session))


@router.post("/locations/reverse-geocode", response_model=PlaceResponse)
def reverse_geocode(
    payload: ReverseGeocodeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rate_limit.enforce_action(db, "place_search", str(current_user.id))
    return _place(lambda: place_search.reverse(payload.lat, payload.lng))

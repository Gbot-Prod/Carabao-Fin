"""Snap a map pin to the nearest drivable road (pin quality, control 1).

A pin in a lake, a field or the middle of a forest has no road near it. The
routing engines move such a pin to the nearest road without a warning, which
can be the far shore of a lake. So the pin is checked when it is saved:

* a road within ``ROAD_SNAP_MAX_METERS`` -> the pin is kept, and the point on
  the road is stored next to it (control 2) for routing and the rider;
* no road within that distance -> the pin is refused;
* the road service is down or not set up -> the pin is accepted without a
  road point (fail open), so an outage never blocks checkout.

Providers (``ROAD_SNAP_PROVIDER``; empty uses ``MAPS_PROVIDER``):
  ``google`` (default when MAPS_PLATFORM_API_KEY is set) - the Roads API
      ``nearestRoads``; the limit is checked here;
  ``mapbox`` (default when only MAPBOX_ACCESS_TOKEN is set) - the Directions
      API, whose ``radiuses`` parameter limits the snap distance;
  ``osrm`` - an OSRM ``/nearest`` server (``OSRM_URL``, default the public
      demo server), for networks that block Mapbox;
  ``off`` (default with no token) - no check.

Logs hold only the HTTP status or the exception type, never the coordinates
(CF-0059: a pin is a buyer's home).
"""

from __future__ import annotations

import logging
import os
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock

import requests as _requests

from app.services import google_maps, maps_provider

logger = logging.getLogger(__name__)

Coords = tuple[float, float]

_MAPBOX_DIRECTIONS = "https://api.mapbox.com/directions/v5/mapbox/driving/"
_DEFAULT_OSRM = "https://router.project-osrm.org"
_DEFAULT_MAX_METERS = 150.0
_TIMEOUT_SECONDS = 5
_CACHE_SIZE = 2048


@dataclass(frozen=True)
class Snap:
    """A road within the limit: the point on it, and how far the pin is."""

    road: Coords
    distance_m: float


class NoRoad:
    """No drivable road within the limit."""

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "NO_ROAD"


NO_ROAD = NoRoad()
# None: not checked (provider off, or the service did not answer).
SnapResult = Snap | NoRoad | None

_cache: OrderedDict[tuple[str, float, float, float], Snap | NoRoad] = OrderedDict()
_cache_lock = Lock()


def max_meters() -> float:
    try:
        value = float(os.getenv("ROAD_SNAP_MAX_METERS", ""))
    except ValueError:
        return _DEFAULT_MAX_METERS
    return value if value > 0 else _DEFAULT_MAX_METERS


def provider() -> str:
    chosen = os.getenv("ROAD_SNAP_PROVIDER", "").strip().lower()
    if chosen in ("google", "mapbox", "osrm", "off"):
        return chosen
    # MAPS_PROVIDER, or the provider that has a key; "off" without its key.
    default = maps_provider.default_provider()
    key = (
        maps_provider.google_key()
        if default == "google"
        else maps_provider.mapbox_token()
    )
    return default if key else "off"


def _google(lat: float, lng: float, limit: float) -> SnapResult:
    try:
        found = google_maps.nearest_road(lat, lng)
    except google_maps.GoogleUnavailable:
        return None
    if found is None:
        return NO_ROAD
    road, distance = found
    if distance > limit:
        return NO_ROAD
    return Snap(road=road, distance_m=distance)


def _mapbox(lat: float, lng: float, limit: float) -> SnapResult:
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token:
        return None
    point = f"{lng},{lat}"
    resp = _requests.get(
        f"{_MAPBOX_DIRECTIONS}{point};{point}",
        params={
            "access_token": token,
            "radiuses": f"{limit:.0f};{limit:.0f}",
            "overview": "false",
            "steps": "false",
        },
        timeout=_TIMEOUT_SECONDS,
    )
    try:
        body = resp.json()
    except ValueError:
        body = {}
    # NoSegment: no road within the radius. Mapbox answers it with HTTP 422.
    if body.get("code") == "NoSegment":
        return NO_ROAD
    if not resp.ok or body.get("code") != "Ok":
        logger.warning(
            "road snap: Mapbox HTTP %s (code=%s)", resp.status_code, body.get("code")
        )
        return None
    return _from_waypoint(body.get("waypoints") or [], limit)


def _osrm(lat: float, lng: float, limit: float) -> SnapResult:
    base = os.getenv("OSRM_URL", _DEFAULT_OSRM).rstrip("/")
    resp = _requests.get(
        f"{base}/nearest/v1/driving/{lng},{lat}",
        params={"number": 1},
        timeout=_TIMEOUT_SECONDS,
    )
    if not resp.ok:
        logger.warning("road snap: OSRM HTTP %s", resp.status_code)
        return None
    body = resp.json()
    if body.get("code") != "Ok":
        return NO_ROAD if body.get("code") == "NoSegment" else None
    return _from_waypoint(body.get("waypoints") or [], limit)


def _from_waypoint(waypoints: list[dict], limit: float) -> SnapResult:
    if not waypoints:
        return None
    first = waypoints[0]
    location = first.get("location") or []
    distance = first.get("distance")
    if len(location) != 2 or not isinstance(distance, int | float):
        return None
    # OSRM /nearest has no radius, so the limit is checked here for both.
    if distance > limit:
        return NO_ROAD
    return Snap(
        road=(float(location[1]), float(location[0])), distance_m=float(distance)
    )


def snap_to_road(lat: float, lng: float) -> SnapResult:
    """The nearest road point for a pin, NO_ROAD, or None if not checked."""
    name = provider()
    if name == "off":
        return None
    limit = max_meters()
    # ~1 m precision: a re-save of the same pin uses the first answer.
    key = (name, limit, round(lat, 5), round(lng, 5))
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    try:
        snap = {"google": _google, "mapbox": _mapbox}.get(name, _osrm)
        result = snap(lat, lng, limit)
    except Exception as exc:
        logger.warning("road snap failed: %s", type(exc).__name__)
        return None
    if result is None:
        return None  # not cached: the next save tries again
    with _cache_lock:
        _cache[key] = result
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return result


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()

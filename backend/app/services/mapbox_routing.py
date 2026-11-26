"""Road durations and route lines for shipments and merchant routes (CF-0059).

``ROUTING_PROVIDER`` (or ``MAPS_PROVIDER``, see ``maps_provider.py``) picks
Google (``google_maps.py``) or the Mapbox calls in this file. The module name
stays, because the routes and the tests import it.

One copy of the Directions and Matrix calls (they were copied in
``routes/merchants.py`` and ``routes/shipments.py``). Logs hold only the HTTP
status or the exception type: a ``requests`` exception text can contain the
request URL, and the URL has the ``access_token``.
"""

from __future__ import annotations

import logging
import os
from typing import Any, cast

import requests as _requests

from app.services import google_maps, maps_provider
from app.utils.lru import TTLCache

logger = logging.getLogger(__name__)

_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving/"
_MATRIX_URL = "https://api.mapbox.com/directions-matrix/v1/mapbox/driving/"


def _coord_path(coords: list[tuple[float, float]]) -> str:
    return ";".join(f"{lng},{lat}" for lat, lng in coords)


def leg_durations(coords: list[tuple[float, float]]) -> list[float] | None:
    """Cumulative driving seconds from coords[0] to each next coord, or None."""
    if maps_provider.routing_provider() == "google":
        return google_maps.leg_durations(coords)
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token or len(coords) < 2:
        return None
    try:
        resp = _requests.get(
            _DIRECTIONS_URL + _coord_path(coords),
            params={"access_token": token, "overview": "false"},
            timeout=10,
        )
        if not resp.ok:
            logger.warning("mapbox directions: HTTP %s", resp.status_code)
            return None
        legs = resp.json().get("routes", [{}])[0].get("legs", [])
        cumulative: list[float] = []
        total = 0.0
        for leg in legs:
            total += leg.get("duration", 0.0)
            cumulative.append(total)
        return cumulative
    except Exception as exc:
        logger.warning("mapbox directions failed: %s", type(exc).__name__)
        return None


# Mapbox Directions takes at most 25 coordinates; Google computeRoutes 27.
_MAX_ROUTE_POINTS = 25


def _max_route_points(google: bool) -> int:
    return google_maps.MAX_ROUTE_POINTS if google else _MAX_ROUTE_POINTS


# A shipment's stops do not move, and the tracking page polls, so one answer
# per set of stops is enough. Failures are not cached.
_route_cache: TTLCache[dict[str, Any] | None] = TTLCache(
    maxsize=500, ttl_seconds=6 * 3600
)


def route_geometry(coords: list[tuple[float, float]]) -> dict[str, Any] | None:
    """The driving route through ``coords`` as a GeoJSON Feature, or None.

    Drawn on the tracking and routing maps. The browser used to ask Mapbox
    itself with the public token; now it asks the API (rate limited, cached).
    """
    google = maps_provider.routing_provider() == "google"
    if len(coords) < 2 or len(coords) > _max_route_points(google):
        return None
    key = (
        "google" if google else "mapbox",
        tuple((round(lat, 6), round(lng, 6)) for lat, lng in coords),
    )
    hit = _route_cache.get(key)
    if hit is not TTLCache.missing():
        return hit  # type: ignore[return-value]
    if google:
        try:
            geometry: Any = google_maps.route_line(coords)
        except google_maps.GoogleUnavailable:
            return None
        return _cache_route(key, geometry)
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token:
        return None
    try:
        resp = _requests.get(
            _DIRECTIONS_URL + _coord_path(coords),
            params={
                "access_token": token,
                "geometries": "geojson",
                "overview": "full",
            },
            timeout=10,
        )
        if not resp.ok:
            logger.warning("mapbox route: HTTP %s", resp.status_code)
            return None
        routes = resp.json().get("routes") or []
        geometry = routes[0].get("geometry") if routes else None
    except Exception as exc:
        logger.warning("mapbox route failed: %s", type(exc).__name__)
        return None
    return _cache_route(key, geometry)


def _cache_route(key: Any, geometry: Any) -> dict[str, Any] | None:
    feature = (
        {"type": "Feature", "properties": {}, "geometry": geometry}
        if isinstance(geometry, dict) and geometry.get("type") == "LineString"
        else None
    )
    # "No route" is an answer too: cache it so a poll does not ask again.
    _route_cache.put(key, feature)
    return feature


def clear_route_cache() -> None:
    _route_cache.clear()


def duration_matrix(
    coords: list[tuple[float, float]],
) -> list[list[float | None]] | None:
    """All-pairs driving seconds, coords[0] first, or None on any failure.

    A None entry means no road route was found for that pair.
    """
    if maps_provider.routing_provider() == "google":
        return google_maps.duration_matrix(coords)
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token:
        logger.warning("mapbox matrix: MAPBOX_ACCESS_TOKEN is not set")
        return None
    try:
        resp = _requests.get(
            _MATRIX_URL + _coord_path(coords),
            params={"access_token": token, "annotations": "duration"},
            timeout=10,
        )
        if not resp.ok:
            logger.warning("mapbox matrix: HTTP %s", resp.status_code)
            return None
        body = resp.json()
        durations = body.get("durations")
        if body.get("code") != "Ok" or not durations or len(durations) != len(coords):
            logger.warning("mapbox matrix: bad response (code=%s)", body.get("code"))
            return None
        return cast(list[list[float | None]], durations)
    except Exception as exc:
        logger.warning("mapbox matrix failed: %s", type(exc).__name__)
        return None

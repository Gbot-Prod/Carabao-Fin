"""Google Maps Platform calls (Routes, Geocoding, Roads) with the server key.

The Mapbox modules (``mapbox_routing``, ``place_search``, ``road_snap``,
``utils/geocoding``) call these functions when ``maps_provider`` selects
Google. Each function gives the same shape of answer as its Mapbox copy, so
the callers and the web and mobile clients do not change.

APIs to enable for ``MAPS_PLATFORM_API_KEY``: Routes API, Geocoding API,
Roads API, Places API (New) (the street suggestions).

Logs hold only the HTTP status or the exception type (CF-0059): the
Geocoding and Roads URLs have the key, and a query or a pin is a person's
address.
"""

from __future__ import annotations

import logging
import math
from typing import Any

import requests as _requests

from app.services.maps_provider import google_key
from app.services.service_area import LUZON_BBOX

logger = logging.getLogger(__name__)

Coords = tuple[float, float]

_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
_ROADS_URL = "https://roads.googleapis.com/v1/nearestRoads"

# computeRoutes: origin + 25 intermediates + destination.
MAX_ROUTE_POINTS = 27
# computeRouteMatrix: at most 625 elements in one request. 25 x 25 tiles keep
# each request inside that limit and inside 50 waypoints.
_MATRIX_TILE = 25
_TIMEOUT_SECONDS = 10

# The service area (Luzon) for the Geocoding "bounds" bias: "sw|ne".
_MIN_LNG, _MIN_LAT, _MAX_LNG, _MAX_LAT = LUZON_BBOX
_BOUNDS = f"{_MIN_LAT},{_MIN_LNG}|{_MAX_LAT},{_MAX_LNG}"


class GoogleUnavailable(Exception):
    """No key, a network failure, or an error answer. Never cached."""


# --- Routes API --------------------------------------------------------------


def _waypoint(point: Coords) -> dict[str, Any]:
    lat, lng = point
    return {"location": {"latLng": {"latitude": lat, "longitude": lng}}}


def _seconds(value: Any) -> float | None:
    """Routes API durations are strings such as ``"123s"`` or ``"12.5s"``."""
    if isinstance(value, str) and value.endswith("s"):
        try:
            return float(value[:-1])
        except ValueError:
            return None
    return None


def _post(url: str, body: dict[str, Any], field_mask: str, what: str) -> Any:
    key = google_key()
    if not key:
        raise GoogleUnavailable("no key")
    try:
        resp = _requests.post(
            url,
            json=body,
            headers={"X-Goog-Api-Key": key, "X-Goog-FieldMask": field_mask},
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("google %s failed: %s", what, type(exc).__name__)
        raise GoogleUnavailable from None
    if not resp.ok:
        logger.warning("google %s: HTTP %s", what, resp.status_code)
        raise GoogleUnavailable
    try:
        return resp.json()
    except ValueError:
        logger.warning("google %s: bad response", what)
        raise GoogleUnavailable from None


def _compute_route(
    coords: list[Coords], field_mask: str, **extra: Any
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "origin": _waypoint(coords[0]),
        "destination": _waypoint(coords[-1]),
        "intermediates": [_waypoint(p) for p in coords[1:-1]],
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_UNAWARE",
        **extra,
    }
    data = _post(_ROUTES_URL, body, field_mask, "route")
    routes = data.get("routes") if isinstance(data, dict) else None
    if not routes:
        # An empty answer: Google found no road route through these points.
        return {}
    first = routes[0]
    return first if isinstance(first, dict) else {}


def leg_durations(coords: list[Coords]) -> list[float] | None:
    """Cumulative driving seconds from coords[0] to each next coord, or None.

    More than ``MAX_ROUTE_POINTS`` points: one request for each part, and
    each part starts at the last point of the part before it.
    """
    if not google_key() or len(coords) < 2:
        return None
    cumulative: list[float] = []
    total = 0.0
    start = 0
    try:
        while start < len(coords) - 1:
            part = coords[start : start + MAX_ROUTE_POINTS]
            legs = _compute_route(part, "routes.legs.duration").get("legs") or []
            if len(legs) != len(part) - 1:
                return None
            for leg in legs:
                total += _seconds(leg.get("duration")) or 0.0
                cumulative.append(total)
            start += len(part) - 1
    except GoogleUnavailable:
        return None
    return cumulative


def route_line(coords: list[Coords]) -> dict[str, Any] | None:
    """The driving route as a GeoJSON LineString geometry, or None (no route).

    Raises GoogleUnavailable on a failure, so the caller does not cache it.
    """
    route = _compute_route(
        coords,
        "routes.polyline.geoJsonLinestring",
        polylineEncoding="GEO_JSON_LINESTRING",
    )
    line = (route.get("polyline") or {}).get("geoJsonLinestring")
    if isinstance(line, dict) and line.get("type") == "LineString":
        return line
    return None


def duration_matrix(coords: list[Coords]) -> list[list[float | None]] | None:
    """All-pairs driving seconds, coords[0] first, or None on any failure.

    A None entry means Google found no road route for that pair.
    """
    if not google_key():
        logger.warning("google matrix: MAPS_PLATFORM_API_KEY is not set")
        return None
    size = len(coords)
    matrix: list[list[float | None]] = [[None] * size for _ in range(size)]
    for i in range(size):
        matrix[i][i] = 0.0
    try:
        for row in range(0, size, _MATRIX_TILE):
            for col in range(0, size, _MATRIX_TILE):
                _matrix_tile(coords, row, col, matrix)
    except GoogleUnavailable:
        return None
    return matrix


def _matrix_tile(
    coords: list[Coords], row: int, col: int, matrix: list[list[float | None]]
) -> None:
    origins = coords[row : row + _MATRIX_TILE]
    destinations = coords[col : col + _MATRIX_TILE]
    body = {
        "origins": [{"waypoint": _waypoint(p)} for p in origins],
        "destinations": [{"waypoint": _waypoint(p)} for p in destinations],
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_UNAWARE",
    }
    elements = _post(
        _MATRIX_URL,
        body,
        "originIndex,destinationIndex,duration,condition",
        "matrix",
    )
    if not isinstance(elements, list):
        logger.warning("google matrix: bad response")
        raise GoogleUnavailable
    for element in elements:
        if not isinstance(element, dict):
            continue
        # Proto3 JSON leaves out a zero index.
        i = row + int(element.get("originIndex", 0))
        j = col + int(element.get("destinationIndex", 0))
        if i == j or i >= len(coords) or j >= len(coords):
            continue
        if element.get("condition") != "ROUTE_EXISTS":
            continue
        # A route of zero seconds (two pins at the same spot) has no duration.
        matrix[i][j] = _seconds(element.get("duration")) or 0.0


# --- Geocoding API -----------------------------------------------------------

# Google result types -> the Mapbox feature types the clients read
# (``util/geocode.ts`` placeHints, mobile ``lib/pinLocation.ts``). In the
# Philippines: admin level 2 is the province (Mapbox "region"), admin level 1
# is the region or Metro Manila, locality is the city, and sublocality or
# neighborhood is the barangay.
_FEATURE_KINDS: tuple[tuple[str, str], ...] = (
    ("street_address", "address"),
    ("premise", "address"),
    ("subpremise", "address"),
    ("route", "address"),
    ("intersection", "address"),
    ("point_of_interest", "poi"),
    ("establishment", "poi"),
    ("neighborhood", "neighborhood"),
    ("sublocality_level_1", "locality"),
    ("sublocality", "locality"),
    ("locality", "place"),
    ("administrative_area_level_3", "place"),
    ("administrative_area_level_2", "region"),
    ("administrative_area_level_1", "district"),
    ("postal_code", "postcode"),
    ("country", "country"),
)
_CONTEXT_KINDS = dict(_FEATURE_KINDS[7:])


def _kind(types: list[str]) -> str:
    for google_type, kind in _FEATURE_KINDS:
        if google_type in types:
            return kind
    return "address"


def _feature(result: dict[str, Any]) -> dict[str, Any] | None:
    """One Geocoding result in the trimmed Mapbox feature shape, or None."""
    location = (result.get("geometry") or {}).get("location") or {}
    lat, lng = location.get("lat"), location.get("lng")
    if not isinstance(lat, int | float) or not isinstance(lng, int | float):
        return None
    types = [str(t) for t in result.get("types") or []]
    kind = _kind(types)
    components = [
        c for c in result.get("address_components") or [] if isinstance(c, dict)
    ]
    context: list[dict[str, str]] = []
    for index, component in enumerate(components):
        component_types = component.get("types") or []
        for google_type, context_kind in _CONTEXT_KINDS.items():
            if google_type in component_types:
                context.append(
                    {
                        "id": f"{context_kind}.{index}",
                        "text": str(component.get("long_name", "")),
                    }
                )
                break
    text = str(components[0].get("long_name", "")) if components else None
    return {
        "id": f"{kind}.{result.get('place_id', '')}",
        "place_type": [kind],
        "text": text,
        "place_name": result.get("formatted_address"),
        "center": [float(lng), float(lat)],
        "context": context,
    }


def _geocode(params: dict[str, str], what: str) -> list[dict[str, Any]]:
    """The Geocoding results. Raises GoogleUnavailable on a failure."""
    key = google_key()
    if not key:
        raise GoogleUnavailable("no key")
    try:
        resp = _requests.get(
            _GEOCODE_URL,
            params={**params, "region": "ph", "language": "en", "key": key},
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("google %s failed: %s", what, type(exc).__name__)
        raise GoogleUnavailable from None
    if not resp.ok:
        logger.warning("google %s: HTTP %s", what, resp.status_code)
        raise GoogleUnavailable
    try:
        body = resp.json()
    except ValueError:
        logger.warning("google %s: bad response", what)
        raise GoogleUnavailable from None
    status = body.get("status")
    if status == "ZERO_RESULTS":
        return []
    if status != "OK":
        logger.warning("google %s: status %s", what, status)
        raise GoogleUnavailable
    return [r for r in body.get("results") or [] if isinstance(r, dict)]


def forward_feature(query: str) -> dict[str, Any] | None:
    """The best place for an address, in the Mapbox feature shape, or None."""
    results = _geocode(
        {"address": query, "components": "country:PH", "bounds": _BOUNDS},
        "geocode",
    )
    return _feature(results[0]) if results else None


def reverse_feature(lat: float, lng: float) -> dict[str, Any] | None:
    """The place at a pin, in the Mapbox feature shape, or None."""
    results = _geocode({"latlng": f"{lat:.6f},{lng:.6f}"}, "reverse geocode")
    # A plus code ("8Q6R+2X ...") is no help to the person: use a named place.
    named = [r for r in results if (r.get("types") or []) != ["plus_code"]]
    return _feature(named[0]) if named else None


# --- Places API (New): street suggestions in the address forms ---------------

_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
_PLACE_URL = "https://places.googleapis.com/v1/places/"
_PLACE_FIELDS = "id,types,location,formattedAddress,addressComponents"
MAX_SUGGESTIONS = 5


def autocomplete(query: str, session: str | None) -> list[dict[str, Any]]:
    """Up to five places for the typed text, without coordinates.

    Each one is ``{"id", "title", "subtitle", "center": None}``; the client
    asks ``place_feature`` for the coordinates of the one the person picks.
    Raises GoogleUnavailable on a failure.
    """
    body: dict[str, Any] = {
        "input": query,
        "includedRegionCodes": ["ph"],
        "languageCode": "en",
        "locationRestriction": {
            "rectangle": {
                "low": {"latitude": _MIN_LAT, "longitude": _MIN_LNG},
                "high": {"latitude": _MAX_LAT, "longitude": _MAX_LNG},
            }
        },
    }
    if session:
        body["sessionToken"] = session
    data = _post(
        _AUTOCOMPLETE_URL,
        body,
        "suggestions.placePrediction.placeId,"
        "suggestions.placePrediction.text.text,"
        "suggestions.placePrediction.structuredFormat",
        "autocomplete",
    )
    suggestions = data.get("suggestions") if isinstance(data, dict) else None
    found: list[dict[str, Any]] = []
    for item in suggestions or []:
        prediction = (item or {}).get("placePrediction") or {}
        place_id = prediction.get("placeId")
        if not isinstance(place_id, str) or not place_id:
            continue
        structured = prediction.get("structuredFormat") or {}
        title = (structured.get("mainText") or {}).get("text") or (
            prediction.get("text") or {}
        ).get("text")
        if not title:
            continue
        found.append(
            {
                "id": place_id,
                "title": str(title),
                "subtitle": str(
                    (structured.get("secondaryText") or {}).get("text") or ""
                ),
                "center": None,
            }
        )
        if len(found) >= MAX_SUGGESTIONS:
            break
    return found


def place_feature(place_id: str, session: str | None) -> dict[str, Any] | None:
    """One picked suggestion in the Mapbox feature shape, or None.

    Raises GoogleUnavailable on a failure.
    """
    key = google_key()
    if not key:
        raise GoogleUnavailable("no key")
    params = {"languageCode": "en"}
    if session:
        params["sessionToken"] = session
    try:
        resp = _requests.get(
            f"{_PLACE_URL}{place_id}",
            params=params,
            headers={
                "X-Goog-Api-Key": key,
                "X-Goog-FieldMask": _PLACE_FIELDS,
            },
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("google place failed: %s", type(exc).__name__)
        raise GoogleUnavailable from None
    if resp.status_code == 404:
        return None
    if not resp.ok:
        logger.warning("google place: HTTP %s", resp.status_code)
        raise GoogleUnavailable
    try:
        body = resp.json()
        location = body.get("location") or {}
        # The Places shape -> the Geocoding shape that ``_feature`` reads.
        return _feature(
            {
                "place_id": body.get("id", place_id),
                "types": body.get("types") or [],
                "formatted_address": body.get("formattedAddress"),
                "geometry": {
                    "location": {
                        "lat": location.get("latitude"),
                        "lng": location.get("longitude"),
                    }
                },
                "address_components": [
                    {"long_name": c.get("longText", ""), "types": c.get("types") or []}
                    for c in body.get("addressComponents") or []
                    if isinstance(c, dict)
                ],
            }
        )
    except (AttributeError, TypeError, ValueError):
        logger.warning("google place: bad response")
        raise GoogleUnavailable from None


# --- Roads API ---------------------------------------------------------------


def _meters(a: Coords, b: Coords) -> float:
    lat1, lng1, lat2, lng2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def nearest_road(lat: float, lng: float) -> tuple[Coords, float] | None:
    """The nearest road point and its distance in meters, or None (no road).

    Raises GoogleUnavailable on a failure, so the pin is not refused for an
    outage.
    """
    key = google_key()
    if not key:
        raise GoogleUnavailable("no key")
    try:
        resp = _requests.get(
            _ROADS_URL,
            params={"points": f"{lat:.6f},{lng:.6f}", "key": key},
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("google roads failed: %s", type(exc).__name__)
        raise GoogleUnavailable from None
    if not resp.ok:
        logger.warning("google roads: HTTP %s", resp.status_code)
        raise GoogleUnavailable
    try:
        points = resp.json().get("snappedPoints") or []
    except (AttributeError, ValueError):
        logger.warning("google roads: bad response")
        raise GoogleUnavailable from None
    for point in points:
        location = (point or {}).get("location") or {}
        road_lat, road_lng = location.get("latitude"), location.get("longitude")
        if isinstance(road_lat, int | float) and isinstance(road_lng, int | float):
            road = (float(road_lat), float(road_lng))
            return road, _meters((lat, lng), road)
    return None

"""Mapbox place lookups for the map pin picker, run here instead of the browser.

The picker used to call the Geocoding API with the public browser token, so
anyone could copy that token and spend it. Now the browser asks these
functions through ``/locations/geocode`` and ``/locations/reverse-geocode``:
signed in, rate limited, cached, with the server's token.

The answer keeps only the feature fields the picker reads (``util/geocode.ts``).
Logs hold only the HTTP status or the exception type: the request URL has the
access token, and the query is a person's address.
"""

from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import quote

import requests as _requests

from app.services.service_area import in_luzon_bbox
from app.utils.lru import TTLCache

logger = logging.getLogger(__name__)

_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places/"
_TYPES = "address,poi,neighborhood,locality,place"
_TIMEOUT_SECONDS = 8
MAX_QUERY_LENGTH = 256

# Same address typed again, or the pin dropped on the same spot: no new call.
_cache: TTLCache[dict[str, Any] | None] = TTLCache(maxsize=2000, ttl_seconds=6 * 3600)


class PlaceSearchUnavailable(Exception):
    """Mapbox did not answer (or no token). Not cached; the caller says 503."""


def _trim(feature: dict[str, Any]) -> dict[str, Any] | None:
    center = feature.get("center")
    if not (isinstance(center, list) and len(center) == 2):
        return None
    context = [
        {"id": str(c.get("id", "")), "text": str(c.get("text", ""))}
        for c in feature.get("context") or []
        if isinstance(c, dict)
    ]
    return {
        "id": feature.get("id"),
        "place_type": [str(t) for t in feature.get("place_type") or []],
        "text": feature.get("text"),
        "place_name": feature.get("place_name"),
        "center": [float(center[0]), float(center[1])],
        "context": context,
    }


def _search(path: str, params: dict[str, str]) -> dict[str, Any] | None:
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token:
        raise PlaceSearchUnavailable("no token")
    try:
        resp = _requests.get(
            f"{_BASE}{path}.json",
            params={
                "country": "PH",
                "limit": "1",
                "types": _TYPES,
                **params,
                "access_token": token,
            },
            timeout=_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.warning("place search failed: %s", type(exc).__name__)
        raise PlaceSearchUnavailable from None
    if not resp.ok:
        logger.warning("place search: Mapbox HTTP %s", resp.status_code)
        raise PlaceSearchUnavailable
    try:
        features = resp.json().get("features") or []
        return _trim(features[0]) if features else None
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        logger.warning("place search: bad response (%s)", type(exc).__name__)
        raise PlaceSearchUnavailable from None


def forward(query: str) -> dict[str, Any] | None:
    """The best place for a typed address, or None when Mapbox finds nothing."""
    cleaned = " ".join(query.split())[:MAX_QUERY_LENGTH]
    if not cleaned:
        return None
    key = ("fwd", cleaned.lower())
    hit = _cache.get(key)
    if hit is not TTLCache.missing():
        return hit  # type: ignore[return-value]
    result = _search(quote(cleaned, safe=""), {"autocomplete": "false"})
    _cache.put(key, result)
    return result


def reverse(lat: float, lng: float) -> dict[str, Any] | None:
    """The place at a pin, or None. Pins outside Luzon are not looked up."""
    if not in_luzon_bbox(lat, lng):
        return None
    # ~1 m: a pin dragged back to the same spot uses the first answer.
    key = ("rev", round(lat, 5), round(lng, 5))
    hit = _cache.get(key)
    if hit is not TTLCache.missing():
        return hit  # type: ignore[return-value]
    result = _search(f"{lng:.6f},{lat:.6f}", {})
    _cache.put(key, result)
    return result


def clear_cache() -> None:
    _cache.clear()

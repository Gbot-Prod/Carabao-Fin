"""Place lookups for the map pin picker, run here instead of the browser.

``GEOCODE_PROVIDER`` (or ``MAPS_PROVIDER``) picks Google (``google_maps.py``)
or Mapbox. Both give the trimmed Mapbox feature shape below.

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
from collections.abc import Callable
from typing import Any
from urllib.parse import quote

import requests as _requests

from app.services import google_maps, maps_provider
from app.services.service_area import LUZON_BBOX, in_luzon_bbox
from app.utils.lru import TTLCache

logger = logging.getLogger(__name__)

_BASE = "https://api.mapbox.com/geocoding/v5/mapbox.places/"
_TYPES = "address,poi,neighborhood,locality,place"
_TIMEOUT_SECONDS = 8
MAX_QUERY_LENGTH = 256

# Same address typed again, or the pin dropped on the same spot: no new call.
_cache: TTLCache[dict[str, Any] | None] = TTLCache(maxsize=2000, ttl_seconds=6 * 3600)


class PlaceSearchUnavailable(Exception):
    """The provider did not answer (or no key). Not cached; the caller says 503."""


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
    features = _features(path, params)
    return _trim(features[0]) if features else None


def _features(path: str, params: dict[str, str]) -> list[dict[str, Any]]:
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
        return [f for f in features if isinstance(f, dict)]
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        logger.warning("place search: bad response (%s)", type(exc).__name__)
        raise PlaceSearchUnavailable from None


def _google(lookup: Callable[[], dict[str, Any] | None]) -> dict[str, Any] | None:
    try:
        return lookup()
    except google_maps.GoogleUnavailable:
        raise PlaceSearchUnavailable from None


def forward(query: str) -> dict[str, Any] | None:
    """The best place for a typed address, or None when Mapbox finds nothing."""
    cleaned = " ".join(query.split())[:MAX_QUERY_LENGTH]
    if not cleaned:
        return None
    google = maps_provider.geocode_provider() == "google"
    key = ("google" if google else "mapbox", "fwd", cleaned.lower())
    hit = _cache.get(key)
    if hit is not TTLCache.missing():
        return hit  # type: ignore[return-value]
    if google:
        result = _google(lambda: google_maps.forward_feature(cleaned))
    else:
        result = _search(quote(cleaned, safe=""), {"autocomplete": "false"})
    _cache.put(key, result)
    return result


def reverse(lat: float, lng: float) -> dict[str, Any] | None:
    """The place at a pin, or None. Pins outside Luzon are not looked up."""
    if not in_luzon_bbox(lat, lng):
        return None
    # ~1 m: a pin dragged back to the same spot uses the first answer.
    google = maps_provider.geocode_provider() == "google"
    key = ("google" if google else "mapbox", "rev", round(lat, 5), round(lng, 5))
    hit = _cache.get(key)
    if hit is not TTLCache.missing():
        return hit  # type: ignore[return-value]
    if google:
        result = _google(lambda: google_maps.reverse_feature(lat, lng))
    else:
        result = _search(f"{lng:.6f},{lat:.6f}", {})
    _cache.put(key, result)
    return result


def _mapbox_suggestion(feature: dict[str, Any]) -> dict[str, Any] | None:
    trimmed = _trim(feature)
    if not trimmed:
        return None
    name = str(trimmed.get("place_name") or trimmed.get("text") or "")
    title, _, subtitle = name.partition(", ")
    if not title:
        return None
    return {
        "id": str(trimmed.get("id") or title),
        "title": title,
        "subtitle": subtitle,
        "center": trimmed["center"],
    }


def suggest(query: str, session: str | None = None) -> list[dict[str, Any]]:
    """Street suggestions for the address forms (dropdown under the street field).

    Mapbox suggestions have their coordinates; Google ones do not, and the
    client asks ``place`` for the one the person picks.
    """
    cleaned = " ".join(query.split())[:MAX_QUERY_LENGTH]
    if len(cleaned) < 3:
        return []
    google = maps_provider.geocode_provider() == "google"
    key = ("google" if google else "mapbox", "suggest", cleaned.lower())
    hit = _cache.get(key)
    if hit is not TTLCache.missing():
        return hit  # type: ignore[return-value]
    if google:
        try:
            result = google_maps.autocomplete(cleaned, session)
        except google_maps.GoogleUnavailable:
            raise PlaceSearchUnavailable from None
    else:
        features = _features(
            quote(cleaned, safe=""),
            {
                "autocomplete": "true",
                "limit": str(google_maps.MAX_SUGGESTIONS),
                "types": "address,poi,neighborhood,locality",
                # The service area only (Google: locationRestriction).
                "bbox": ",".join(str(v) for v in LUZON_BBOX),
            },
        )
        result = [s for s in map(_mapbox_suggestion, features) if s]
    _cache.put(key, result)  # type: ignore[arg-type]
    return result


def place(place_id: str, session: str | None = None) -> dict[str, Any] | None:
    """The picked Google suggestion as a feature (with its coordinates), or None."""
    key = ("google", "place", place_id)
    hit = _cache.get(key)
    if hit is not TTLCache.missing():
        return hit  # type: ignore[return-value]
    result = _google(lambda: google_maps.place_feature(place_id, session))
    _cache.put(key, result)
    return result


def clear_cache() -> None:
    _cache.clear()

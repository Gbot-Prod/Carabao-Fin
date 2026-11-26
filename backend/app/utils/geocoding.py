from __future__ import annotations

import logging
import os
import time
from urllib.parse import quote

import requests as _requests

from app.services import google_maps, maps_provider
from app.services.service_area import LUZON_BBOX, in_luzon_bbox

# Carabao serves the Luzon island group only (B2).
_LUZON_BBOX = ",".join(str(v) for v in LUZON_BBOX)
_METRO_MANILA_PROXIMITY = "120.9842,14.5995"
_GEOCODE_ATTEMPTS = 3
_GEOCODE_TIMEOUT_SECONDS = 10
_geocode_cache: dict[str, tuple[float, float]] = {}

# CF-0059: logs never hold the address, the coordinates or an exception text.
# Addresses are buyers' home addresses (PII), and a requests exception text
# can contain the request URL with the access_token.
logger = logging.getLogger(__name__)


def _normalise_address(address: str) -> str:
    cleaned = address.strip()
    lower = cleaned.lower()
    if "philippines" not in lower and ", ph" not in lower:
        cleaned = f"{cleaned}, Philippines"
    return cleaned


def _geocode_google(address: str) -> tuple[float, float] | None:
    for attempt in range(1, _GEOCODE_ATTEMPTS + 1):
        try:
            feature = google_maps.forward_feature(_normalise_address(address))
            break
        except google_maps.GoogleUnavailable:
            if attempt == _GEOCODE_ATTEMPTS:
                logger.warning(
                    "geocode: Google unavailable after %s attempts",
                    _GEOCODE_ATTEMPTS,
                )
                return None
            time.sleep(0.5 * attempt)
            logger.info("geocode: retry %s/%s", attempt + 1, _GEOCODE_ATTEMPTS)
    if not feature:
        logger.info("geocode: no result")
        return None
    lng, lat = feature["center"]
    if not in_luzon_bbox(lat, lng):
        logger.info("geocode: result outside Luzon")
        return None
    return (lat, lng)


def _geocode_sync(address: str) -> tuple[float, float] | None:
    if not address.strip():
        return None
    if maps_provider.geocode_provider() == "google":
        return _geocode_google(address)
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token or not address.strip():
        return None

    normalised = _normalise_address(address)
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(normalised)}.json"
    params = {
        "country": "PH",
        "bbox": _LUZON_BBOX,
        "proximity": _METRO_MANILA_PROXIMITY,
        "types": "address,poi,place,locality,neighborhood",
        "limit": 1,
        "access_token": token,
    }
    for attempt in range(1, _GEOCODE_ATTEMPTS + 1):
        try:
            resp = _requests.get(
                url,
                params=params,
                timeout=_GEOCODE_TIMEOUT_SECONDS,
            )
            break
        except (
            _requests.exceptions.Timeout,
            _requests.exceptions.ConnectionError,
        ) as exc:
            if attempt == _GEOCODE_ATTEMPTS:
                logger.warning(
                    "geocode: Mapbox unavailable after %s attempts (%s)",
                    _GEOCODE_ATTEMPTS,
                    type(exc).__name__,
                )
                return None
            time.sleep(0.5 * attempt)
            logger.info("geocode: retry %s/%s", attempt + 1, _GEOCODE_ATTEMPTS)
    try:
        if not resp.ok:
            logger.warning("geocode: Mapbox HTTP %s", resp.status_code)
            return None

        body = resp.json()
        features = body.get("features", [])
        if not features:
            logger.info("geocode: no result")
            return None

        feature = features[0]
        relevance = feature.get("relevance", 1.0)
        if relevance < 0.4:
            logger.info("geocode: low-confidence result (relevance=%.2f)", relevance)

        lng, lat = feature["center"]
        if not in_luzon_bbox(lat, lng):
            logger.info("geocode: result outside Luzon")
            return None
        return (lat, lng)
    except _requests.exceptions.RequestException as exc:
        logger.warning("geocode: Mapbox request failed (%s)", type(exc).__name__)
        return None
    except (KeyError, TypeError, ValueError) as exc:
        logger.warning("geocode: invalid Mapbox response (%s)", type(exc).__name__)
        return None
    except Exception as exc:
        logger.warning("geocode failed (%s)", type(exc).__name__)
        return None


def _geocode(address: str) -> tuple[float, float] | None:
    key = f"{maps_provider.geocode_provider()}:{address.strip().lower()}"
    if key in _geocode_cache:
        return _geocode_cache[key]
    result = _geocode_sync(address)
    if result:
        _geocode_cache[key] = result
    return result

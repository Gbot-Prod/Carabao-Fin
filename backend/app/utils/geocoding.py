from __future__ import annotations

import asyncio
import os
from urllib.parse import quote

import requests as _requests

_PH_BBOX = "116.928,4.587,126.604,21.321"
_METRO_MANILA_PROXIMITY = "120.9842,14.5995"
_geocode_cache: dict[str, tuple[float, float]] = {}


def _normalise_address(address: str) -> str:
    cleaned = address.strip()
    lower = cleaned.lower()
    if "philippines" not in lower and ", ph" not in lower:
        cleaned = f"{cleaned}, Philippines"
    return cleaned


def _geocode_sync(address: str) -> tuple[float, float] | None:
    token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
    if not token or not address.strip():
        return None

    normalised = _normalise_address(address)
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(normalised)}.json"
    try:
        resp = _requests.get(
            url,
            params={
                "country": "PH",
                "bbox": _PH_BBOX,
                "proximity": _METRO_MANILA_PROXIMITY,
                "types": "address,poi,place,locality,neighborhood",
                "limit": 1,
                "access_token": token,
            },
            timeout=5,
        )
        if not resp.ok:
            print(f"[geocode] Mapbox error {resp.status_code} for address: {normalised!r}")
            return None

        body = resp.json()
        features = body.get("features", [])
        if not features:
            print(f"[geocode] No results for address: {normalised!r}")
            return None

        feature = features[0]
        relevance = feature.get("relevance", 1.0)
        if relevance < 0.4:
            print(f"[geocode] Low-confidence result (relevance={relevance:.2f}) for: {normalised!r} → {feature.get('place_name')}")

        lng, lat = feature["center"]
        print(f"[geocode] {normalised!r} → ({lat:.5f}, {lng:.5f})  place={feature.get('place_name')!r}  relevance={relevance:.2f}")
        return (lat, lng)
    except Exception as exc:
        print(f"[geocode] Exception for address {normalised!r}: {exc}")
        return None


async def _geocode(address: str) -> tuple[float, float] | None:
    key = address.strip().lower()
    if key in _geocode_cache:
        return _geocode_cache[key]
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, _geocode_sync, address)
    if result:
        _geocode_cache[key] = result
    return result

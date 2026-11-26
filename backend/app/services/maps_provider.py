"""Which map provider each map feature uses (Google Maps Platform or Mapbox).

One global switch and one override for each feature:

  ``MAPS_PROVIDER``      - ``google`` or ``mapbox``. Default: ``google`` when
                           ``MAPS_PLATFORM_API_KEY`` is set, else ``mapbox``.
  ``ROUTING_PROVIDER``   - Directions, Matrix and the road line on the maps.
  ``GEOCODE_PROVIDER``   - address -> coordinates, and the pin picker search.
  ``ROAD_SNAP_PROVIDER`` - the pin road check (also ``osrm`` and ``off``;
                           see ``road_snap.py``).

An override that is empty or not known uses ``MAPS_PROVIDER``.
"""

from __future__ import annotations

import os
from typing import Literal

Provider = Literal["google", "mapbox"]

_PROVIDERS: tuple[Provider, ...] = ("google", "mapbox")


def google_key() -> str:
    return os.getenv("MAPS_PLATFORM_API_KEY", "")


def mapbox_token() -> str:
    return os.getenv("MAPBOX_ACCESS_TOKEN", "")


def _read(name: str) -> Provider | None:
    value = os.getenv(name, "").strip().lower()
    return value if value in _PROVIDERS else None


def default_provider() -> Provider:
    chosen = _read("MAPS_PROVIDER")
    if chosen:
        return chosen
    return "google" if google_key() else "mapbox"


def routing_provider() -> Provider:
    return _read("ROUTING_PROVIDER") or default_provider()


def geocode_provider() -> Provider:
    return _read("GEOCODE_PROVIDER") or default_provider()

"""Mapbox road durations for shipments and merchant routes (CF-0059).

One copy of the Directions and Matrix calls (they were copied in
``routes/merchants.py`` and ``routes/shipments.py``). Logs hold only the HTTP
status or the exception type: a ``requests`` exception text can contain the
request URL, and the URL has the ``access_token``.
"""

from __future__ import annotations

import logging
import os
from typing import cast

import requests as _requests

logger = logging.getLogger(__name__)

_DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/driving/"
_MATRIX_URL = "https://api.mapbox.com/directions-matrix/v1/mapbox/driving/"


def _coord_path(coords: list[tuple[float, float]]) -> str:
    return ";".join(f"{lng},{lat}" for lat, lng in coords)


def leg_durations(coords: list[tuple[float, float]]) -> list[float] | None:
    """Cumulative driving seconds from coords[0] to each next coord, or None."""
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


def duration_matrix(
    coords: list[tuple[float, float]],
) -> list[list[float | None]] | None:
    """All-pairs driving seconds, coords[0] first, or None on any failure.

    A None entry means Mapbox found no road route for that pair.
    """
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

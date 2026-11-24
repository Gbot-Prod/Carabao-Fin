"""Server-side check that a map pin is inside the city and barangay chosen.

The web form compares the pin with the city (frontend lib/pin-area.ts), but a
client that calls the API directly could save "Makati" with a pin in Bicol.
Then the address text and the pin disagree, which confuses riders and fees.

Here the server compares the pin with its own PSGC boundary polygons
(psgc_boundaries, loaded by scripts/load_psgc_boundaries.py):

* pin inside the city and the barangay (within the tolerances): no mismatch;
* pin outside them, but at most ``MAX_CITY_DISTANCE_M`` from the city: the
  address is saved with ``pin_area_mismatch = true`` and a log line (no
  coordinates, no address text). Pins at a city line and simplified polygons
  make a hard rule refuse correct addresses;
* pin more than ``MAX_CITY_DISTANCE_M`` from the city: refused (400);
* no pin, no city, or no polygon for the city: not checked (``None``).

No PostGIS (the Railway image does not have it). Each check reads one or two
polygons by primary key and tests them with shapely in local metres.
"""

from __future__ import annotations

import gzip
import json
import logging
import math
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from shapely import Point, from_wkb, make_valid, to_wkb, transform
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from sqlalchemy import delete, insert, literal
from sqlalchemy.orm import Session

from app.models.psgc_area import PsgcArea
from app.models.psgc_boundary import PsgcBoundary

logger = logging.getLogger(__name__)

# Made by scripts/fetch_psgc_boundaries.py. One JSON object per line:
# {"code": "0301410000", "level": "city", "geometry": {GeoJSON, lng/lat}}.
SEED_FILE = Path(__file__).resolve().parents[1] / "data" / "psgc_boundaries.jsonl.gz"
LEVELS = ("city", "barangay")

# The medium-resolution polygons keep 1% of the source vertices, and a gate on
# the boundary road can be a few metres over the line.
CITY_TOLERANCE_M = 200.0
BARANGAY_TOLERANCE_M = 200.0
# Farther than this from the chosen city is not a pin at a city line.
MAX_CITY_DISTANCE_M = 5_000.0

_M_PER_DEG_LAT = 110_574.0
_M_PER_DEG_LNG_EQUATOR = 111_320.0

Coords = tuple[float, float]


def _distance_m(geometry: BaseGeometry, pin: Coords) -> float:
    """Metres from the pin to the polygon; 0 inside it.

    The polygon is moved to a flat x/y in metres around the pin
    (equirectangular). The error is below 1% at the distances used here.
    """
    lat0, lng0 = pin
    m_per_deg_lng = _M_PER_DEG_LNG_EQUATOR * math.cos(math.radians(lat0))

    def to_metres(xy: Any) -> Any:
        out = xy.copy()
        out[:, 0] = (xy[:, 0] - lng0) * m_per_deg_lng
        out[:, 1] = (xy[:, 1] - lat0) * _M_PER_DEG_LAT
        return out

    return float(transform(geometry, to_metres).distance(Point(0.0, 0.0)))


def _shape(db: Session, code: str | None, level: str) -> BaseGeometry | None:
    if not code:
        return None
    row = db.get(PsgcBoundary, code)
    if row is None or row.level != level:
        return None
    return from_wkb(bytes(row.geometry))


def city_at(db: Session, pin: Coords) -> PsgcArea | None:
    """The PSGC city/municipality whose polygon holds the pin, if any."""
    lat, lng = pin
    rows = (
        db.query(PsgcBoundary)
        .filter(
            PsgcBoundary.level == "city",
            literal(lat).between(PsgcBoundary.min_lat, PsgcBoundary.max_lat),
            literal(lng).between(PsgcBoundary.min_lng, PsgcBoundary.max_lng),
        )
        .all()
    )
    for row in rows:
        if from_wkb(bytes(row.geometry)).covers(Point(lng, lat)):
            return db.get(PsgcArea, row.code)
    return None


def _too_far_detail(db: Session, city_code: str, pin: Coords, distance: float) -> str:
    chosen = db.get(PsgcArea, city_code)
    city = str(chosen.name) if chosen is not None else "the city you chose"
    found = city_at(db, pin)
    where = f" It is in {found.name}." if found is not None else ""
    return (
        f"This pin is {distance / 1000:.1f} km outside {city}.{where} Move the pin "
        f"into {city}, or choose the city where the pin is."
    )


def check(
    db: Session,
    pin: Coords | None,
    city_code: str | None,
    barangay_code: str | None,
    *,
    kind: str = "address",
) -> bool | None:
    """Whether the pin is outside the chosen city or barangay.

    Returns None when the check cannot run. Raises a 400 when the pin is more
    than ``MAX_CITY_DISTANCE_M`` from the city. ``kind`` names the record in
    the log line.
    """
    if pin is None or not city_code:
        return None
    city = _shape(db, city_code, "city")
    if city is None:
        return None
    city_m = _distance_m(city, pin)
    if city_m > MAX_CITY_DISTANCE_M:
        logger.info(
            "pin_area refused kind=%s city=%s city_m=%d", kind, city_code, city_m
        )
        raise HTTPException(
            status_code=400, detail=_too_far_detail(db, city_code, pin, city_m)
        )

    barangay = _shape(db, barangay_code, "barangay")
    barangay_m = _distance_m(barangay, pin) if barangay is not None else None
    mismatch = city_m > CITY_TOLERANCE_M or (
        barangay_m is not None and barangay_m > BARANGAY_TOLERANCE_M
    )
    if mismatch:
        logger.info(
            "pin_area mismatch kind=%s city=%s city_m=%d barangay=%s barangay_m=%s",
            kind,
            city_code,
            city_m,
            barangay_code,
            "-" if barangay_m is None else int(barangay_m),
        )
    return mismatch


# ---------------------------------------------------------------- loading


def read_rows(path: Path = SEED_FILE) -> Iterator[dict[str, Any]]:
    """The psgc_boundaries rows of a seed file, polygons as WKB."""
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            code, level = str(item.get("code", "")), item.get("level")
            if not re.fullmatch(r"\d{10}", code) or level not in LEVELS:
                raise ValueError(f"Line {line_no}: bad code or level")
            geometry = shape(item["geometry"])
            if not geometry.is_valid:
                geometry = make_valid(geometry)
            if geometry.is_empty or geometry.geom_type not in (
                "Polygon",
                "MultiPolygon",
                "GeometryCollection",
            ):
                raise ValueError(f"Line {line_no}: not a polygon")
            min_lng, min_lat, max_lng, max_lat = geometry.bounds
            yield {
                "code": code,
                "level": level,
                "min_lat": min_lat,
                "min_lng": min_lng,
                "max_lat": max_lat,
                "max_lng": max_lng,
                "geometry": to_wkb(geometry),
            }


def load(db: Session, path: Path = SEED_FILE) -> int:
    """Replace psgc_boundaries with the rows of ``path``, in one transaction."""
    db.execute(delete(PsgcBoundary))
    count, batch = 0, []
    for row in read_rows(path):
        batch.append(row)
        if len(batch) == 1000:
            db.execute(insert(PsgcBoundary), batch)
            count, batch = count + len(batch), []
    if batch:
        db.execute(insert(PsgcBoundary), batch)
        count += len(batch)
    db.commit()
    return count


# ---------------------------------------------------------------- saving


def apply(db: Session, target: Any, *, kind: str) -> None:
    """Check a model's saved pin against its city/barangay codes and set its
    ``pin_area_mismatch``. Call it after the pin and the area are set."""
    lat, lng = target.lat, target.lng
    pin = (float(lat), float(lng)) if lat is not None and lng is not None else None
    target.pin_area_mismatch = check(
        db, pin, target.city_code, target.barangay_code, kind=kind
    )

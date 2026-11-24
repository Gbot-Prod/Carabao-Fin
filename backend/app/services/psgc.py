"""Server-side check of region -> province -> city -> barangay (PSGC).

The address forms pick each level from the PSGC lists, but the API used to take
the four names as plain text, so "NCR / Benguet / Cebu City" was accepted and
the region a client sent decided the Luzon check. Here the server finds each
level in its own copy of the PSGC (psgc_areas, loaded from app/data/psgc.csv)
and checks that each one is inside its parent. The region, and so the Luzon
check, comes from the PSGC row, not from the client.

A client may send the PSGC codes (``region_code`` ... ``barangay_code``) or only
the names. A code wins over a name; the stored names are always the PSGC names.
NCR has no provinces: its province is "Metro Manila" and its cities hang off the
region, as in the forms.
"""

from __future__ import annotations

import csv
import logging
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from app.models.psgc_area import PSGC_LEVELS, PsgcArea
from app.services.service_area import OUTSIDE_LUZON_DETAIL

logger = logging.getLogger(__name__)

SEED_FILE = Path(__file__).resolve().parents[1] / "data" / "psgc.csv"
COLUMNS = (
    "code",
    "level",
    "name",
    "parent_code",
    "region_code",
    "city_type",
    "postal_code",
)

NCR_CODE = "1300000000"
NCR_PROVINCE = "Metro Manila"
# The Luzon island group (service_area.py): Regions I-V, NCR and CAR.
# MIMAROPA (1700000000) is not served.
LUZON_REGION_CODES = frozenset(
    {
        "0100000000",
        "0200000000",
        "0300000000",
        "0400000000",
        "0500000000",
        NCR_CODE,
        "1400000000",
    }
)

AREA_FIELDS = ("region", "province", "city", "barangay")
CODE_FIELDS = tuple(f"{field}_code" for field in AREA_FIELDS)

LIST_MISSING_DETAIL = "The address lists are not available. Try again later."
_POSTAL_CODE = re.compile(r"\d{4}")


class AreaError(ValueError):
    """An address level that is not in the PSGC, or not inside its parent."""

    def __init__(self, field: str, message: str) -> None:
        super().__init__(message)
        self.field = field
        self.message = message


class AreaListMissing(RuntimeError):
    """psgc_areas is empty: scripts/load_psgc.py was not run."""


@dataclass(frozen=True)
class Area:
    region: str
    province: str
    city: str
    barangay: str | None
    region_code: str
    province_code: str | None
    city_code: str
    barangay_code: str | None
    # The city's postal code from the PSGC source, if it has one.
    postal_code: str | None

    @property
    def in_luzon(self) -> bool:
        return self.region_code in LUZON_REGION_CODES

    def columns(self) -> dict[str, str | None]:
        """The eight address columns, for setattr on a model."""
        return {field: getattr(self, field) for field in (*AREA_FIELDS, *CODE_FIELDS)}


def name_key(text: str) -> str:
    """Case, accents, punctuation and spacing ignored: "Las Piñas" == "las pinas"."""
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^\w]+", " ", plain.casefold()).split())


def _region_keys(name: str) -> set[str]:
    """ "Region III (Central Luzon)" answers to its full name, "Region III" and
    "Central Luzon"; NCR also to "Metro Manila"."""
    keys = {name_key(name)}
    match = re.fullmatch(r"\s*(.*?)\s*\((.*)\)\s*", name)
    if match:
        keys |= {name_key(match.group(1)), name_key(match.group(2))}
    keys.discard("")
    return keys


def _blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


# ---------------------------------------------------------------- loading


def read_rows(path: Path = SEED_FILE) -> list[dict[str, str | None]]:
    rows: list[dict[str, str | None]] = []
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = set(COLUMNS) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"Missing columns: {', '.join(sorted(missing))}")
        for line, raw in enumerate(reader, start=2):
            code = (raw["code"] or "").strip()
            level = (raw["level"] or "").strip()
            name = " ".join((raw["name"] or "").split())
            if not re.fullmatch(r"\d{10}", code) or level not in PSGC_LEVELS:
                raise ValueError(f"Line {line}: bad code or level")
            if not name:
                raise ValueError(f"Line {line}: name is required")
            postal = (raw["postal_code"] or "").strip()
            rows.append(
                {
                    "code": code,
                    "level": level,
                    "name": name,
                    "name_key": name_key(name),
                    "parent_code": (raw["parent_code"] or "").strip() or None,
                    "region_code": (raw["region_code"] or "").strip(),
                    "city_type": (raw["city_type"] or "").strip() or None,
                    "postal_code": postal if _POSTAL_CODE.fullmatch(postal) else None,
                }
            )
    return rows


def load(db: Session, path: Path = SEED_FILE) -> int:
    """Replace psgc_areas with the rows of ``path``, in one transaction."""
    rows = read_rows(path)
    db.execute(delete(PsgcArea))
    for start in range(0, len(rows), 5000):
        db.execute(insert(PsgcArea), rows[start : start + 5000])
    db.commit()
    return len(rows)


# ---------------------------------------------------------------- resolving


def _by_code(db: Session, code: str, level: str) -> PsgcArea | None:
    row = db.get(PsgcArea, code)
    return row if row is not None and row.level == level else None


def _child(
    db: Session,
    *,
    level: str,
    parent_code: str,
    name: str | None,
    code: str | None,
    field: str,
    parent_name: str,
) -> PsgcArea:
    label = {"province": "province", "city": "city or municipality"}.get(level, level)
    if code:
        row = _by_code(db, code, level)
        if row is None:
            raise AreaError(field, f"Unknown {label} code.")
        if row.parent_code != parent_code:
            raise AreaError(field, f"{row.name} is not in {parent_name}.")
        return row
    if _blank(name):
        raise AreaError(field, f"Choose a {label}.")
    matches = (
        db.query(PsgcArea)
        .filter(
            PsgcArea.parent_code == parent_code,
            PsgcArea.level == level,
            PsgcArea.name_key == name_key(str(name)),
        )
        .all()
    )
    if not matches:
        raise AreaError(field, f"Choose a {label} in {parent_name} from the list.")
    if len(matches) > 1:
        raise AreaError(field, f"More than one {label} has this name. Send its code.")
    return matches[0]


def _region(db: Session, name: str | None, code: str | None) -> PsgcArea:
    if code:
        row = _by_code(db, code, "region")
        if row is None:
            raise AreaError("region", "Unknown region code.")
        return row
    if _blank(name):
        raise AreaError("region", "Choose a region.")
    key = name_key(str(name))
    regions = db.query(PsgcArea).filter(PsgcArea.level == "region").all()
    if not regions:
        raise AreaListMissing
    for row in regions:
        keys = _region_keys(str(row.name))
        if row.code == NCR_CODE:
            keys.add(name_key(NCR_PROVINCE))
        if key in keys:
            return row
    raise AreaError("region", "Choose a region from the list.")


def resolve_area(
    db: Session,
    values: Mapping[str, Any],
    *,
    luzon_only: bool = True,
) -> Area:
    """Find region, province, city and barangay in the PSGC, or raise AreaError.

    ``values`` holds the names (``region`` ...) and optional codes
    (``region_code`` ...). The barangay is required when the city has
    barangays in the list (City of Manila has none: its districts do).
    """
    if db.query(PsgcArea.code).first() is None:
        raise AreaListMissing
    region = _region(db, values.get("region"), values.get("region_code"))
    if luzon_only and region.code not in LUZON_REGION_CODES:
        raise AreaError("region", OUTSIDE_LUZON_DETAIL)

    province: PsgcArea | None = None
    if region.code == NCR_CODE:
        if values.get("province_code") or not (
            _blank(values.get("province"))
            or name_key(str(values.get("province"))) == name_key(NCR_PROVINCE)
        ):
            raise AreaError(
                "province", f"Metro Manila has no provinces. Use {NCR_PROVINCE}."
            )
        city_parent, city_parent_name = region.code, NCR_PROVINCE
    else:
        province = _child(
            db,
            level="province",
            parent_code=str(region.code),
            name=values.get("province"),
            code=values.get("province_code"),
            field="province",
            parent_name=str(region.name),
        )
        city_parent, city_parent_name = str(province.code), str(province.name)

    city = _child(
        db,
        level="city",
        parent_code=city_parent,
        name=values.get("city"),
        code=values.get("city_code"),
        field="city",
        parent_name=city_parent_name,
    )

    barangay: PsgcArea | None = None
    has_barangays = (
        db.query(PsgcArea.code)
        .filter(PsgcArea.parent_code == city.code, PsgcArea.level == "barangay")
        .first()
        is not None
    )
    sent_barangay = not _blank(values.get("barangay")) or values.get("barangay_code")
    if has_barangays:
        barangay = _child(
            db,
            level="barangay",
            parent_code=str(city.code),
            name=values.get("barangay"),
            code=values.get("barangay_code"),
            field="barangay",
            parent_name=str(city.name),
        )
    elif sent_barangay:
        raise AreaError(
            "barangay",
            f"{city.name} has no barangays here. Choose its district as the city.",
        )

    return Area(
        region=str(region.name),
        province=str(province.name) if province is not None else NCR_PROVINCE,
        city=str(city.name),
        barangay=str(barangay.name) if barangay is not None else None,
        region_code=str(region.code),
        province_code=str(province.code) if province is not None else None,
        city_code=str(city.code),
        barangay_code=str(barangay.code) if barangay is not None else None,
        postal_code=city.postal_code,  # type: ignore[arg-type]
    )


def check_postal_code(value: str | None, area: Area | None) -> str | None:
    """A 4-digit PH postal code; a blank one is filled from the city if known.

    Not compared with the city: the source's codes have gaps and errors, so a
    mismatch would refuse correct addresses.
    """
    if _blank(value):
        return area.postal_code if area is not None else None
    cleaned = str(value).strip()
    if not _POSTAL_CODE.fullmatch(cleaned):
        raise AreaError("postal_code", "Enter the 4-digit postal code.")
    return cleaned


def has_area(values: Mapping[str, Any]) -> bool:
    return any(not _blank(values.get(f)) for f in (*AREA_FIELDS, *CODE_FIELDS))


def merged_area_values(current: Any, updates: Mapping[str, Any]) -> dict[str, Any]:
    """The values to resolve for a PATCH that changes part of an address.

    Names not in the request come from the stored row (they are PSGC names).
    Stored codes are not reused: a new name with an old code below it would
    point at the old place.
    """
    values: dict[str, Any] = {
        field: updates[field] if field in updates else getattr(current, field, None)
        for field in AREA_FIELDS
    }
    for field in CODE_FIELDS:
        values[field] = updates.get(field)
    return values


def http_error(exc: AreaError | AreaListMissing) -> HTTPException:
    """The 400 (or 503) a plain JSON route answers with."""
    if isinstance(exc, AreaListMissing):
        logger.error("psgc_areas is empty; run scripts/load_psgc.py")
        return HTTPException(status_code=503, detail=LIST_MISSING_DETAIL)
    return HTTPException(status_code=400, detail=exc.message)

"""Carabao's service area: the Luzon island group (B2).

"Luzon" here is the Luzon island group as the PSA groups regions: NCR, CAR,
Regions I, II, III, IV-A (CALABARZON), MIMAROPA (IV-B) and V (Bicol). Visayas
and Mindanao regions are outside the service area.
"""

from __future__ import annotations

import re

OUTSIDE_LUZON_DETAIL = (
    "Carabao currently serves Luzon only (Metro Manila, CAR, Ilocos, Cagayan "
    "Valley, Central Luzon, CALABARZON, MIMAROPA and Bicol)."
)
DELIVERY_OUTSIDE_LUZON_DETAIL = (
    "We can only deliver within Luzon. Include your province or Metro Manila city "
    "in the delivery address."
)

# Lng/lat box around the Luzon island group, Batanes to southern Palawan and
# Catanduanes, for Mapbox geocoding. It keeps out Mindanao and the eastern
# Visayas, but a box this wide also covers Panay, Negros and Cebu, so the real
# check is on the address at entry (is_luzon_region / address_in_luzon).
LUZON_BBOX = (116.9, 7.8, 124.5, 21.2)

_REGION_NAMES = (
    "ncr",
    "national capital",
    "metro manila",
    "car",
    "cordillera",
    "ilocos",
    "cagayan valley",
    "central luzon",
    "calabarzon",
    "mimaropa",
    "southwestern tagalog",
    "bicol",
)
# Regions I-V (IV covers IV-A and IV-B), written as Roman or Arabic numerals.
_REGION_NUMBERS = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5}

LUZON_PROVINCES = frozenset(
    {
        # CAR
        "abra", "apayao", "benguet", "ifugao", "kalinga", "mountain province",
        # Region I
        "ilocos norte", "ilocos sur", "la union", "pangasinan",
        # Region II
        "batanes", "cagayan", "isabela", "nueva vizcaya", "quirino",
        # Region III
        "aurora", "bataan", "bulacan", "nueva ecija", "pampanga", "tarlac",
        "zambales",
        # Region IV-A
        "batangas", "cavite", "laguna", "quezon", "rizal",
        # MIMAROPA
        "marinduque", "occidental mindoro", "oriental mindoro", "mindoro",
        "palawan", "romblon",
        # Region V
        "albay", "camarines norte", "camarines sur", "catanduanes", "masbate",
        "sorsogon",
    }
)  # fmt: skip

METRO_MANILA = frozenset(
    {
        "metro manila", "ncr", "manila", "quezon city", "caloocan", "las pinas",
        "las piñas", "makati", "malabon", "mandaluyong", "marikina", "muntinlupa",
        "navotas", "paranaque", "parañaque", "pasay", "pasig", "san juan",
        "taguig", "valenzuela", "pateros",
    }
)  # fmt: skip

# Places outside Luzon whose names contain a Luzon place name.
_OUTSIDE_LUZON = ("basilan",)


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _has_word(haystack: str, needle: str) -> bool:
    return re.search(rf"(?<![\w]){re.escape(needle)}(?![\w])", haystack) is not None


def is_luzon_region(region: str | None) -> bool:
    """True for a Luzon island group region, however the name is written."""
    if not region or not region.strip():
        return False
    name = _norm(region)
    if any(_has_word(name, n) for n in _REGION_NAMES):
        return True
    match = re.search(r"\bregion\s*-?\s*([ivx]+|\d+)\b", name)
    if not match:
        return False
    numeral = match.group(1)
    number = int(numeral) if numeral.isdigit() else _REGION_NUMBERS.get(numeral)
    return number is not None and 1 <= number <= 5


def address_in_luzon(address: str | None) -> bool:
    """Best-effort check of a free-text delivery address.

    Looks for a Luzon province or Metro Manila city in the parts after the first
    comma, so a street named after a province ("Rizal St, Cebu City") doesn't
    count. An address with no commas is checked as a whole.
    """
    if not address or not address.strip():
        return False
    text = _norm(address)
    if any(_has_word(text, place) for place in _OUTSIDE_LUZON):
        return False
    parts = [p.strip() for p in text.split(",") if p.strip()]
    search = ", ".join(parts[1:]) if len(parts) > 1 else text
    return any(_has_word(search, place) for place in LUZON_PROVINCES | METRO_MANILA)


def in_luzon_bbox(lat: float, lng: float) -> bool:
    min_lng, min_lat, max_lng, max_lat = LUZON_BBOX
    return min_lat <= lat <= max_lat and min_lng <= lng <= max_lng

"""Build app/data/psgc_boundaries.jsonl.gz from the PSGC boundary maps.

    uv run python scripts/fetch_psgc_boundaries.py [path/to/out.jsonl.gz]

Source: github.com/faeldon/philippines-json-maps (MIT), release ``RELEASE``,
medium resolution GeoJSON (1% of the PSA/NAMRIA vertices), PSGC 3Q 2026.
Each feature carries its PSGC code, so it joins psgc_areas by code:

    provdists/  one file per province or NCR district: city/municipality shapes
    municities/ one file per city: barangay (and Manila district) shapes

The file keeps only Luzon (the served area) and only the codes that are in
app/data/psgc.csv, with the level that file gives them (Manila's districts are
cities there). Coordinates are rounded to 5 decimals (about 1 m).

Run it again when the PSGC changes (after scripts/fetch_psgc.py), review the
counts, then load it with scripts/load_psgc_boundaries.py.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path
from typing import Any

import requests

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.pin_area import SEED_FILE  # noqa: E402
from app.services.psgc import LUZON_REGION_CODES  # noqa: E402
from app.services.psgc import SEED_FILE as PSGC_FILE  # noqa: E402

RELEASE = "v1.1.1"
BASE = f"https://github.com/faeldon/philippines-json-maps/releases/download/{RELEASE}"
ZIP_NAME = "geojson-medres.zip"


def _download(name: str) -> bytes:
    res = requests.get(f"{BASE}/{name}", timeout=300)
    res.raise_for_status()
    return res.content


def _checked_zip() -> zipfile.ZipFile:
    data = _download(ZIP_NAME)
    sums = _download("SHA256SUMS").decode("utf-8")
    expected = next(
        (line.split()[0] for line in sums.splitlines() if line.endswith(ZIP_NAME)),
        None,
    )
    actual = hashlib.sha256(data).hexdigest()
    if expected != actual:
        raise RuntimeError(f"{ZIP_NAME}: SHA-256 does not match SHA256SUMS")
    return zipfile.ZipFile(io.BytesIO(data))


def _round(coords: Any) -> Any:
    if isinstance(coords, float | int):
        return round(float(coords), 5)
    return [_round(c) for c in coords]


def _luzon_levels() -> dict[str, str]:
    """PSGC code -> level for the Luzon cities and barangays."""
    with PSGC_FILE.open(encoding="utf-8", newline="") as fh:
        return {
            row["code"]: row["level"]
            for row in csv.DictReader(fh)
            if row["level"] in ("city", "barangay")
            and row["region_code"] in LUZON_REGION_CODES
        }


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else SEED_FILE
    levels = _luzon_levels()
    archive = _checked_zip()
    shapes: dict[str, dict[str, Any]] = {}
    # Province files first: a city's own shape wins over a copy in a city file.
    names = sorted(
        (n for n in archive.namelist() if n.endswith(".json")),
        key=lambda n: (0 if "/provdists/" in n else 1, n),
    )
    for name in names:
        if "/provdists/" in name:
            key = "adm3_psgc"
        elif "/municities/" in name:
            key = "adm4_psgc"
        else:
            continue
        for feature in json.loads(archive.read(name))["features"]:
            raw = feature["properties"].get(key)
            geometry = feature.get("geometry")
            if raw is None or not geometry:
                continue
            code = str(int(raw)).zfill(10)
            if code in levels and code not in shapes:
                shapes[code] = {
                    "type": geometry["type"],
                    "coordinates": _round(geometry["coordinates"]),
                }

    with gzip.open(out, "wt", encoding="utf-8", compresslevel=9) as fh:
        for code in sorted(shapes):
            line = {"code": code, "level": levels[code], "geometry": shapes[code]}
            fh.write(json.dumps(line, separators=(",", ":")) + "\n")

    for level in ("city", "barangay"):
        total = sum(1 for v in levels.values() if v == level)
        have = sum(1 for c in shapes if levels[c] == level)
        print(f"{level}: {have} of {total} Luzon places have a shape")
    print(f"Wrote {len(shapes)} shapes to {out} ({out.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main()

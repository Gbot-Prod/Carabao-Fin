"""Download the PSGC lists from psgc.cloud into app/data/psgc.csv.

    uv run python scripts/fetch_psgc.py [path/to/out.csv]

The web and mobile address forms read the same API (frontend/carabao-app/util/psgc.ts,
mobile/CarabaoMerchantMobile/src/lib/psgc.ts), so the names in the file are the
names the clients send. The script walks the lists the way the clients do:

    region -> provinces -> cities/municipalities -> barangays
    NCR (no provinces)  -> cities/municipalities -> barangays

so each row's parent is the parent the form shows (City of Baguio is under
Benguet, Manila's districts are under NCR). Run it again when the PSA publishes
a new PSGC, review the diff, then load it with scripts/load_psgc.py.

Postal codes: psgc.cloud has a zip_code for about two thirds of the cities and
some are wrong (2026-11: San Nicolas, Manila shows 9503). The file keeps a code
only when it is 4 digits. The API uses it to fill a blank postal code, never to
refuse one.
"""

from __future__ import annotations

import csv
import re
import sys
import time
from pathlib import Path

import requests

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.psgc import COLUMNS, SEED_FILE  # noqa: E402

BASE = "https://psgc.cloud/api/v2"
NCR_CODE = "1300000000"
# psgc.cloud allows 120 requests a minute; stay below it.
MIN_INTERVAL_S = 0.6
_last_request = 0.0
_session = requests.Session()
_session.headers.update(
    {"Accept": "application/json", "User-Agent": "psgc-sync-script/1.0"}
)


def _get(path: str) -> list[dict]:
    global _last_request
    for attempt in range(6):
        wait = _last_request + MIN_INTERVAL_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        try:
            res = _session.get(f"{BASE}/{path}", timeout=60)
            if res.status_code == 200:
                return res.json()["data"]
            if res.status_code == 429:
                time.sleep(float(res.headers.get("Retry-After") or 60))
                continue
        except requests.RequestException:
            pass
        time.sleep(2**attempt)
    raise RuntimeError(f"PSGC request failed: {path}")


def _clean(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip()


def _zip(value: str | None) -> str:
    value = (value or "").strip()
    return value if re.fullmatch(r"\d{4}", value) else ""


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else SEED_FILE
    rows: list[dict[str, str]] = []
    cities: list[tuple[str, str]] = []  # (city code, region code)

    for region in _get("regions/"):
        rcode = region["code"]
        rows.append(
            {"code": rcode, "level": "region", "name": _clean(region["name"]),
             "parent_code": "", "region_code": rcode, "city_type": "",
             "postal_code": ""}
        )  # fmt: skip
        provinces = [] if rcode == NCR_CODE else _get(f"regions/{rcode}/provinces/")
        parents = [
            (p["code"], f"regions/{rcode}/provinces/{p['code']}/") for p in provinces
        ]
        if not provinces:
            parents = [(rcode, f"regions/{rcode}/")]
        for province in provinces:
            rows.append(
                {"code": province["code"], "level": "province",
                 "name": _clean(province["name"]), "parent_code": rcode,
                 "region_code": rcode, "city_type": "", "postal_code": ""}
            )  # fmt: skip
        for parent_code, prefix in parents:
            for city in _get(f"{prefix}cities-municipalities/"):
                # 2026-11: Sarangani's list also returned all NCR cities. A
                # PSGC code starts with its region's 2 digits; a city of an
                # other region is skipped here and listed under its own.
                if city["code"][:2] != rcode[:2]:
                    continue
                rows.append(
                    {"code": city["code"], "level": "city",
                     "name": _clean(city["name"]), "parent_code": parent_code,
                     "region_code": rcode, "city_type": city.get("type") or "",
                     "postal_code": _zip(city.get("zip_code"))}
                )  # fmt: skip
                cities.append((city["code"], rcode))
        print(f"{region['name']}: {len(parents)} parents", flush=True)

    def barangays(item: tuple[str, str]) -> list[dict[str, str]]:
        ccode, rcode = item
        return [
            {"code": b["code"], "level": "barangay", "name": _clean(b["name"]),
             "parent_code": ccode, "region_code": rcode, "city_type": "",
             "postal_code": ""}
            for b in _get(f"cities-municipalities/{ccode}/barangays/")
        ]  # fmt: skip

    for index, item in enumerate(cities, start=1):
        rows.extend(barangays(item))
        if index % 100 == 0:
            print(f"barangays: {index}/{len(cities)} cities", flush=True)

    seen: set[str] = set()
    unique = []
    for row in rows:
        if row["code"] not in seen:
            seen.add(row["code"])
            unique.append(row)
    unique.sort(key=lambda r: r["code"])
    with out.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(unique)
    print(f"Wrote {len(unique)} rows to {out}")


if __name__ == "__main__":
    main()

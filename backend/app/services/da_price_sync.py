"""Sync reference prices from the DA Price Index API (guardrails Phase 4).

The API (``DA_PRICE_API_URL``) serves the prevailing retail prices from the DA
Daily Price Index PDFs. ``GET /prices/latest`` gives one price per DA
commodity. This module:

1. Keeps only the produce that a farm can sell here (fruits, vegetables,
   spices, root crops, legumes, corn on the cob), per kg, available, and not
   drift flagged by the API.
2. Puts the DA variants of one produce in one group ("Banana (Lakatan)",
   "Banana (Saba)" -> "Banana"). ``low`` is the lowest variant price and
   ``high`` the highest, so the flag band covers all variants.
3. Adds the Tagalog and Bisaya names that farmers use as aliases.
4. Adds the in-house rows from ``app/data/inhouse_reference_prices.csv``:
   produce that DA does not list (kangkong, malunggay, lanzones ...). A DA row
   wins over an in-house row with the same commodity or name.
5. Replaces the SAMPLE, old DA and old in-house rows. Rows that an admin added
   from a CSV with a different source stay, unless the sync has that produce.

Only NCR: the farms deliver to NCR, and buyers there expect NCR prices.

When it runs: ``sync_if_due`` from the background loop in ``main.py`` (every
``DA_PRICE_SYNC_HOURS``, default 6; 0 turns it off), ``POST
/admin/reference-prices/sync-da``, or ``scripts/sync_da_prices.py``.

In-house rows are estimates of the NCR retail price, with a wide band. Check
them against a market visit, change ``low``/``high`` and ``as_of`` in the CSV,
and deploy. They count for the price flags for ``INHOUSE_MAX_AGE_DAYS`` after
``as_of`` (``listing_checks``); after that they only stop the "unknown
produce" flag.
"""

from __future__ import annotations

import logging
import math
import os
import re
import time
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import requests
from sqlalchemy.orm import Session

from app.models.admin_audit_log import AdminAuditLog
from app.models.reference_price import ReferencePrice
from app.services import audit_log, rate_limit, reference_prices

logger = logging.getLogger(__name__)

DEFAULT_API_URL = "https://dapricescraper-production.up.railway.app"
DEFAULT_REGION = "NCR"
SOURCE_PREFIX = "DA Daily Price Index"
INHOUSE_FILE = (
    Path(__file__).resolve().parents[1] / "data" / "inhouse_reference_prices.csv"
)
INHOUSE_SOURCE_PREFIX = "Carabao in-house"
DEFAULT_SYNC_HOURS = 6.0
RETRY_SECONDS = 30 * 60  # after a failed sync, per worker
_LOCK_KEY = "reference-prices:da-sync"
TIMEOUT_SECONDS = 20
# A parse that gives fewer groups than this is probably broken: keep the old rows.
MIN_GROUPS = 20

PRODUCE_CATEGORIES = frozenset(
    {
        "FRUITS",
        "HIGHLAND VEGETABLES",
        "LOWLAND VEGETABLES",
        "SPICES",
        "ROOTCROPS",
        "LEGUMES",
        "CORN PRODUCTS",
    }
)
# Processed goods in the produce categories (not fresh produce).
_SKIP_NAME = re.compile(r"^corn grits", re.IGNORECASE)

# DA names that the automatic rule puts in the wrong group.
GROUP_OVERRIDES: dict[str, str] = {
    "Native Pechay": "Pechay",
    "Habichuelas/Baguio Beans, Local": "Habichuelas",
    "Jute Leaves/Spinach (Saluyot)": "Saluyot",
    "Chilli (Green), Local": "Green Chili",
    "Chilli (Red), Local": "Red Chili",
    "Tiger Chillies, Imported": "Red Chili",
}

# Local names, per group. Matching is on whole words, and the longest name
# wins, so "napa cabbage" goes to Pechay Baguio and "cabbage" to Cabbage.
# Do not add a color or a size alone ("red", "green"): it matches too much.
GROUP_ALIASES: dict[str, tuple[str, ...]] = {
    "Apple": ("mansanas", "apples"),
    "Avocado": ("abukado", "abokado"),
    "Banana": ("saging", "bananas", "lakatan", "latundan", "saba", "saging saba"),
    "Calamansi": ("kalamansi", "calamondin", "limonsito"),
    "Dragon Fruit": ("pitaya",),
    "Grapes": ("ubas", "grape"),
    "Guyabano": ("soursop", "guanabano"),
    "Honeydew Melon": ("honeydew",),
    "Longgan": ("longan",),
    "Lemon": ("limon", "lemons"),
    "Mango": ("mangga", "mangoes", "carabao mango", "indian mango", "manggang kalabaw"),
    "Mangosteen": ("mangostan",),
    "Melon": ("cantaloupe", "muskmelon"),
    "Orange": ("oranges", "kahel"),
    "Papaya": ("kapayas", "green papaya", "hilaw na papaya"),
    "Pear": ("peras", "pears"),
    "Pineapple": ("pinya", "piña"),
    "Pomelo": ("suha", "lukban"),
    "Strawberry": ("strawberries",),
    "Watermelon": ("pakwan",),
    "Bell Pepper": ("bell peppers", "capsicum"),
    "Broccoli": ("brokoli",),
    "Cabbage": ("repolyo",),
    "Carrots": ("carrot", "karot"),
    "Cauliflower": ("koliplor",),
    "Chayote": ("sayote",),
    "Cucumber": ("pipino", "cucumbers"),
    "Habichuelas": ("baguio beans", "habitsuelas", "green beans"),
    "Lettuce": ("litsugas", "romaine", "iceberg"),
    "Pechay Baguio": ("wombok", "napa cabbage", "chinese cabbage"),
    "Radish": ("labanos",),
    "White Potato": ("potato", "potatoes", "patatas"),
    "Bitter Gourd": ("ampalaya", "bitter melon", "amargoso"),
    "Bottle Gourd": ("upo",),
    "Green Chili": (
        "green chilli",
        "siling haba",
        "siling pangsigang",
        "siling panigang",
        "sili",
        "chili",
        "chilli",
    ),
    "Red Chili": ("red chilli", "siling labuyo", "labuyo", "tingala"),
    "Eggplant": ("talong", "eggplants"),
    "Saluyot": ("jute leaves", "jute"),
    "Pechay": ("petsay", "native pechay", "pechay tagalog", "bok choy", "pak choi"),
    "Okra": (),
    "Pole Sitao": ("sitaw", "sitao", "string beans", "yardlong beans", "long beans"),
    "Sponge Gourd": ("patola", "luffa"),
    "Squash": ("kalabasa",),
    "Tomato": ("kamatis", "tomatoes"),
    "Winged Beans": ("sigarilyas", "winged bean"),
    "Garlic": ("bawang", "ahos"),
    "Ginger": ("luya",),
    "Red Onion": ("sibuyas", "onion", "onions", "sibuyas pula", "lasona"),
    "White Onion": ("sibuyas puti",),
    "Mungbean": ("munggo", "monggo", "mongo", "mung bean", "mung beans"),
    "Peanut": ("mani", "peanuts"),
    "Sweet Potato": ("kamote", "camote"),
    "Corn": ("mais", "sweet corn", "glutinous corn", "malagkit na mais"),
}

_ORIGIN = re.compile(r",\s*(native/local|local|imported)\s*$", re.IGNORECASE)
_PAREN = re.compile(r"\s*\(([^)]*)\)")


class DaPriceSyncError(RuntimeError):
    pass


@dataclass
class Group:
    commodity: str
    prices: list[float] = field(default_factory=list)
    dates: list[date] = field(default_factory=list)
    aliases: set[str] = field(default_factory=set)
    da_names: list[str] = field(default_factory=list)


@dataclass
class SyncResult:
    region: str
    as_of: date | None
    groups: int
    skipped_unavailable: int
    skipped_drift: int
    skipped_unit: list[str]
    rows_replaced: int
    rows_kept: int
    inhouse: int = 0
    # In-house rows left out: DA (or a kept admin row) has that produce.
    inhouse_overlap: list[str] = field(default_factory=list)


def api_url() -> str:
    return (os.getenv("DA_PRICE_API_URL") or DEFAULT_API_URL).rstrip("/")


def fetch_latest(region: str = DEFAULT_REGION, *, base_url: str | None = None) -> dict:
    url = f"{base_url or api_url()}/prices/latest"
    try:
        res = requests.get(url, params={"region": region}, timeout=TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise DaPriceSyncError(f"DA price API is not available: {exc}") from exc
    if res.status_code != 200:
        raise DaPriceSyncError(
            f"DA price API returned {res.status_code}: {res.text[:200]}"
        )
    body = res.json()
    if not isinstance(body, dict) or not isinstance(body.get("items"), list):
        raise DaPriceSyncError("DA price API returned an unknown format")
    return body


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def group_name(da_name: str) -> str:
    """The produce group of a DA commodity name."""
    if da_name in GROUP_OVERRIDES:
        return GROUP_OVERRIDES[da_name]
    base = _ORIGIN.sub("", da_name)
    base = _PAREN.sub("", base).strip()
    return base.split("/")[0].strip()


def auto_aliases(da_name: str, group: str) -> set[str]:
    """Names that come from the DA name itself.

    "Bitter Gourd (Ampalaya)" -> "bitter gourd ampalaya", "ampalaya bitter gourd".
    A word in brackets alone is not an alias ("Corn (White)" must not give
    "white"); the curated ``GROUP_ALIASES`` add the useful ones. A name in
    ``GROUP_OVERRIDES`` gets only the curated aliases (the DA name of saluyot
    says "Spinach", and both chili rows say "Chilli").
    """
    if da_name in GROUP_OVERRIDES:
        return set()
    base = _PAREN.sub("", _ORIGIN.sub("", da_name)).strip()
    names = {_norm(part) for part in base.split("/") if part.strip()}
    for inner in _PAREN.findall(da_name):
        for part in inner.split(","):
            word = _norm(part)
            if word:
                names.add(f"{word} {_norm(base)}")
                names.add(f"{_norm(base)} {word}")
    names.discard(_norm(group))
    return names


def build_rows(body: dict) -> tuple[list[dict], dict]:
    """Reference price rows (``reference_prices.parse_rows`` format) and counts."""
    region = str(body.get("region_code") or DEFAULT_REGION)
    groups: dict[str, Group] = {}
    stats = {"unavailable": 0, "drift": 0, "unit": []}
    for item in body["items"]:
        if item.get("top_category") not in PRODUCE_CATEGORIES:
            continue
        name = str(item.get("commodity_name") or "").strip()
        if not name or _SKIP_NAME.match(name):
            continue
        price = item.get("price_prevailing")
        if not item.get("is_available") or price in (None, ""):
            stats["unavailable"] += 1
            continue
        if (item.get("quality") or {}).get("drift_flagged"):
            stats["drift"] += 1
            continue
        if str(item.get("unit") or "").strip().lower() != "kg":
            # The price flags compare per kg only.
            stats["unit"].append(f"{name} ({item.get('unit')})")
            continue
        try:
            value = float(price)
            day = date.fromisoformat(str(item["report_date"]))
        except (KeyError, TypeError, ValueError):
            stats["unavailable"] += 1
            continue
        if value <= 0:
            stats["unavailable"] += 1
            continue
        gname = group_name(name)
        group = groups.setdefault(gname, Group(commodity=gname))
        group.prices.append(value)
        group.dates.append(day)
        group.da_names.append(name)
        group.aliases |= auto_aliases(name, gname)

    rows = []
    for g in sorted(groups.values(), key=lambda g: g.commodity):
        aliases = g.aliases | {_norm(a) for a in GROUP_ALIASES.get(g.commodity, ())}
        aliases.discard(_norm(g.commodity))
        rows.append(
            {
                "commodity": g.commodity,
                "aliases": ";".join(sorted(aliases)),
                "unit": "kg",
                "low": math.floor(min(g.prices)),
                "high": math.ceil(max(g.prices)),
                "source": f"{SOURCE_PREFIX} {region}",
                # The oldest variant date, so the age check is not too kind.
                "as_of": min(g.dates),
            }
        )
    return rows, stats


def _row_names(row: dict) -> set[str]:
    names = [row["commodity"], *row["aliases"].split(";")]
    return {n for n in (reference_prices.norm_name(x) for x in names) if n}


def read_inhouse(path: Path = INHOUSE_FILE) -> list[dict]:
    rows = reference_prices.read_rows(path)
    for row in rows:
        if not row["source"].startswith(INHOUSE_SOURCE_PREFIX):
            raise reference_prices.ReferencePriceFileError(
                f"{row['commodity']}: the source must start with "
                f'"{INHOUSE_SOURCE_PREFIX}"'
            )
    return rows


def merge_inhouse(
    da_rows: list[dict], inhouse: list[dict], kept_rows: list[dict] = ()
) -> tuple[list[dict], list[str]]:
    """``da_rows`` plus the in-house rows that do not overlap a DA row.

    Overlap: the same commodity, or a name or alias that is also a DA name (a
    tie in ``reference_prices.match``). ``kept_rows``: admin rows that stay;
    they also win over an in-house row. Returns (rows, in-house names left out).
    """
    da_names: set[str] = set()
    for row in [*da_rows, *kept_rows]:
        da_names |= _row_names(row)
    merged, overlap = list(da_rows), []
    for row in inhouse:
        if _row_names(row) & da_names:
            overlap.append(row["commodity"])
        else:
            merged.append(row)
    return merged, overlap


def _replaceable(row: ReferencePrice) -> bool:
    return (
        reference_prices.is_sample(row)
        or row.source.startswith(SOURCE_PREFIX)
        or row.source.startswith(INHOUSE_SOURCE_PREFIX)
    )


def apply_rows(
    db: Session, rows: list[dict], *, commit: bool = True
) -> tuple[int, int]:
    """Replace SAMPLE, DA and in-house rows with ``rows``. Keep admin rows.

    An admin row for the same commodity and unit as a new DA row is replaced
    too (the unique key). Returns (rows written, admin rows kept).
    """
    new_keys = {(r["commodity"].lower(), r["unit"].lower()) for r in rows}
    kept = 0
    for old in db.query(ReferencePrice).all():
        if _replaceable(old) or (old.commodity.lower(), old.unit.lower()) in new_keys:
            db.delete(old)
        else:
            kept += 1
    db.flush()
    db.add_all(ReferencePrice(**row) for row in rows)
    if commit:
        db.commit()
    else:
        db.flush()
    return len(rows), kept


def sync(
    db: Session,
    *,
    region: str = DEFAULT_REGION,
    body: dict | None = None,
    commit: bool = True,
) -> SyncResult:
    """Fetch (unless ``body`` is given), build and write DA and in-house rows."""
    body = body if body is not None else fetch_latest(region)
    da_rows, stats = build_rows(body)
    if len(da_rows) < MIN_GROUPS:
        raise DaPriceSyncError(
            f"Only {len(da_rows)} produce prices in the DA report "
            f"(need {MIN_GROUPS}). The old reference prices did not change."
        )
    new_keys = {(r["commodity"].lower(), r["unit"].lower()) for r in da_rows}
    kept = [
        {"commodity": r.commodity, "aliases": r.aliases or ""}
        for r in db.query(ReferencePrice).all()
        if not _replaceable(r) and (r.commodity.lower(), r.unit.lower()) not in new_keys
    ]
    rows, overlap = merge_inhouse(da_rows, read_inhouse(), kept)
    written, kept = apply_rows(db, rows, commit=commit)
    return SyncResult(
        region=str(body.get("region_code") or region),
        as_of=max((r["as_of"] for r in da_rows), default=None),
        groups=len(da_rows),
        skipped_unavailable=stats["unavailable"],
        skipped_drift=stats["drift"],
        skipped_unit=stats["unit"],
        rows_replaced=written,
        rows_kept=kept,
        inhouse=len(rows) - len(da_rows),
        inhouse_overlap=overlap,
    )


def sync_summary(result: SyncResult) -> dict:
    """What the audit row keeps about a sync."""
    return {
        "region": result.region,
        "as_of": result.as_of,
        "groups": result.groups,
        "inhouse": result.inhouse,
        "inhouse_overlap": result.inhouse_overlap,
        "skipped_unit": result.skipped_unit,
    }


# ---------------------------------------------------------------------------
# Scheduled sync (background loop in main.py)
# ---------------------------------------------------------------------------

_next_attempt = 0.0  # time.monotonic() of this worker's next try


def sync_hours() -> float:
    raw = os.getenv("DA_PRICE_SYNC_HOURS", "").strip()
    try:
        return float(raw) if raw else DEFAULT_SYNC_HOURS
    except ValueError:
        return DEFAULT_SYNC_HOURS


def last_sync_at(db: Session) -> datetime | None:
    row = (
        db.query(AdminAuditLog.created_at)
        .filter(AdminAuditLog.action == audit_log.REFERENCE_PRICES_SYNC)
        .order_by(AdminAuditLog.created_at.desc())
        .first()
    )
    if row is None:
        return None
    at = row[0]
    return at if at.tzinfo else at.replace(tzinfo=UTC)


def sync_if_due(db: Session, *, now: datetime | None = None) -> SyncResult | None:
    """Sync when the last sync is older than ``sync_hours()``.

    The last sync is the newest ``reference_prices.sync_da`` audit row, from
    this loop, the admin route or the script. Each API worker runs the loop;
    an advisory lock and a second check stop two workers from syncing at the
    same time. After a failure this worker waits ``RETRY_SECONDS``. Returns
    None when the sync is off, not due, or failed.
    """
    global _next_attempt
    hours = sync_hours()
    if hours <= 0 or time.monotonic() < _next_attempt:
        return None
    now = now or datetime.now(UTC)
    due_before = now - timedelta(hours=hours)
    last = last_sync_at(db)
    if last is not None and last > due_before:
        return None
    rate_limit.lock_keys(db, _LOCK_KEY)
    last = last_sync_at(db)  # another worker can have synced while we waited
    if last is not None and last > due_before:
        db.rollback()
        return None
    try:
        result = sync(db, commit=False)
    except (DaPriceSyncError, reference_prices.ReferencePriceFileError) as exc:
        db.rollback()
        _next_attempt = time.monotonic() + RETRY_SECONDS
        logger.warning("DA price sync failed: %s", exc)
        return None
    audit_log.record_system_action(
        db,
        action=audit_log.REFERENCE_PRICES_SYNC,
        target_type="reference_prices",
        target_id=None,
        after=sync_summary(result),
    )
    db.commit()
    return result

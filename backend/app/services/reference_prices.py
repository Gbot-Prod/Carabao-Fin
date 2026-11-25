"""Market reference prices (P1): load them from a CSV and match them to listings.

The bundled CSV holds SAMPLE placeholder rows only. Replace it with real DA Bantay
Presyo figures and run ``uv run python scripts/load_reference_prices.py``, or
send the CSV to ``POST /admin/reference-prices/import``.

Guardrails Phase 4: the price flags in ``listing_checks`` use only real rows
(``source`` does not start with "SAMPLE"), per kg, at most
``listing_checks.REFERENCE_MAX_AGE_DAYS`` old. ``GET
/admin/reference-prices/status`` tells whether the flags are on.

Planned source: the DA Daily Price Index PDFs on ``DA_PRICE_MONITORING_URL``.
A scraper parses them into the CSV columns below (``prevailing`` or low/high
per commodity, ``source`` such as "DA Daily Price Index NCR", ``as_of`` the
date of the PDF) and calls ``load_rows``.
"""

from __future__ import annotations

import csv
import io
import re
from collections.abc import Iterable
from datetime import date
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.reference_price import ReferencePrice

SEED_FILE = Path(__file__).resolve().parents[1] / "data" / "reference_prices.csv"
SAMPLE_PREFIX = "SAMPLE"
DA_PRICE_MONITORING_URL = "https://www.da.gov.ph/price-monitoring/"
_COLUMNS = ("commodity", "aliases", "unit", "low", "high", "source", "as_of")


_BOM = chr(0xFEFF)


class ReferencePriceFileError(ValueError):
    pass


def read_rows(path: Path = SEED_FILE) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as fh:
        return parse_rows(fh)


def parse_text(text: str) -> list[dict]:
    """The rows of an uploaded CSV (a UTF-8 BOM from Excel is allowed)."""
    return parse_rows(io.StringIO(text.removeprefix(_BOM), newline=""))


def parse_rows(lines: Iterable[str]) -> list[dict]:
    """Check every line of a reference price CSV. Raises on the first error."""
    reader = csv.DictReader(lines)
    missing = set(_COLUMNS) - set(reader.fieldnames or [])
    if missing:
        raise ReferencePriceFileError(f"Missing columns: {', '.join(sorted(missing))}")
    rows = []
    for line, raw in enumerate(reader, start=2):
        try:
            row = {
                "commodity": raw["commodity"].strip(),
                "aliases": ";".join(
                    a.strip() for a in (raw["aliases"] or "").split(";") if a.strip()
                ),
                "unit": (raw["unit"] or "kg").strip(),
                "low": int(raw["low"]),
                "high": int(raw["high"]),
                "source": raw["source"].strip(),
                "as_of": date.fromisoformat(raw["as_of"].strip()),
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise ReferencePriceFileError(f"Line {line}: {exc}") from exc
        if not row["commodity"] or not row["source"]:
            raise ReferencePriceFileError(
                f"Line {line}: commodity and source are required"
            )
        if not 0 <= row["low"] <= row["high"]:
            raise ReferencePriceFileError(f"Line {line}: need 0 <= low <= high")
        rows.append(row)
    return rows


def load(db: Session, path: Path = SEED_FILE) -> int:
    """Replace the whole table with the file's rows. Returns the row count."""
    return load_rows(db, read_rows(path))


def load_rows(db: Session, rows: list[dict], *, commit: bool = True) -> int:
    """Replace the whole table with checked rows (``parse_rows``).

    ``commit=False``: flush only, so the caller can add an audit row to the
    same transaction.
    """
    seen: set[tuple[str, str]] = set()
    for row in rows:
        key = (row["commodity"].strip().lower(), row["unit"].strip().lower())
        if key in seen:
            raise ReferencePriceFileError(
                f"{row['commodity']} ({row['unit']}) is in the file two times"
            )
        seen.add(key)
    db.query(ReferencePrice).delete()
    db.add_all(ReferencePrice(**row) for row in rows)
    if commit:
        db.commit()
    else:
        db.flush()
    return len(rows)


def is_sample(price: ReferencePrice) -> bool:
    return price.source.strip().upper().startswith(SAMPLE_PREFIX)


def norm_name(text: str) -> str:
    """A name as `match` compares it."""
    return _norm(text)


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9ñ ]+", " ", text.lower()).strip()


def _names(price: ReferencePrice) -> list[str]:
    names = [price.commodity, *(price.aliases or "").split(";")]
    return [n for n in (_norm(x) for x in names) if n]


def match(
    prices: list[ReferencePrice], produce_name: str | None, unit: str | None = None
) -> ReferencePrice | None:
    """The reference price whose commodity or alias appears as words in the name.

    The longest matching name wins ("bitter gourd" over "gourd"); a row in the
    listing's unit is preferred over one in another unit.
    """
    if not produce_name:
        return None
    padded = f" {_norm(produce_name)} "
    best: tuple[int, int, ReferencePrice] | None = None
    for price in prices:
        for name in _names(price):
            if f" {name} " in padded:
                score = (len(name), 1 if unit and price.unit == unit else 0)
                if best is None or score > best[:2]:
                    best = (*score, price)
    return best[2] if best else None

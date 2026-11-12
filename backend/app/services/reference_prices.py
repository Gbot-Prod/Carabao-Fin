"""Market reference prices (P1): load them from a CSV and match them to listings.

The bundled CSV holds SAMPLE placeholder rows only. Replace it with real DA Bantay
Presyo figures and run ``uv run python scripts/load_reference_prices.py``.
"""

from __future__ import annotations

import csv
import re
from datetime import date
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.reference_price import ReferencePrice

SEED_FILE = Path(__file__).resolve().parents[1] / "data" / "reference_prices.csv"
SAMPLE_PREFIX = "SAMPLE"
_COLUMNS = ("commodity", "aliases", "unit", "low", "high", "source", "as_of")


class ReferencePriceFileError(ValueError):
    pass


def read_rows(path: Path = SEED_FILE) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        missing = set(_COLUMNS) - set(reader.fieldnames or [])
        if missing:
            raise ReferencePriceFileError(
                f"Missing columns: {', '.join(sorted(missing))}"
            )
        rows = []
        for line, raw in enumerate(reader, start=2):
            try:
                row = {
                    "commodity": raw["commodity"].strip(),
                    "aliases": ";".join(
                        a.strip()
                        for a in (raw["aliases"] or "").split(";")
                        if a.strip()
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
    rows = read_rows(path)
    db.query(ReferencePrice).delete()
    db.add_all(ReferencePrice(**row) for row in rows)
    db.commit()
    return len(rows)


def is_sample(price: ReferencePrice) -> bool:
    return price.source.strip().upper().startswith(SAMPLE_PREFIX)


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

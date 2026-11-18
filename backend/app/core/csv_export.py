"""CSV helpers shared by the admin and merchant exports (CF-0055)."""

import csv
import io
from collections.abc import Iterable, Iterator
from datetime import datetime
from typing import Any

# A cell starting with one of these is a formula in Excel / Sheets.
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def csv_cell(value: Any) -> str:
    """Stringify a value, neutralising spreadsheet formula injection."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    text = str(value)
    if text and text[0] in _FORMULA_START:
        return "'" + text
    return text


def csv_lines(header: list[str], rows: Iterable[Iterable[Any]]) -> Iterator[str]:
    """The header, then one CSV line per row, each cell made safe."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    for row in rows:
        writer.writerow([csv_cell(v) for v in row])
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)
    tail = buf.getvalue()
    if tail:
        yield tail

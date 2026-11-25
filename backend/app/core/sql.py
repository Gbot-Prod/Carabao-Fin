"""Shared SQL helpers (CF-0050, B51)."""

from typing import Any, Literal

from sqlalchemy import ColumnElement, nulls_last

# Escape character for LIKE patterns built by contains_pattern().
LIKE_ESCAPE = "\\"


def contains_pattern(value: str) -> str:
    """A LIKE pattern matching ``value`` anywhere, with ``%`` and ``_`` taken
    literally (a search for "_" must not match every row)."""
    escaped = (
        value.replace(LIKE_ESCAPE, LIKE_ESCAPE * 2)
        .replace("%", LIKE_ESCAPE + "%")
        .replace("_", LIKE_ESCAPE + "_")
    )
    return f"%{escaped}%"


def ilike_contains(column: Any, value: str) -> ColumnElement[bool]:
    """Case-insensitive "contains ``value``" on ``column``, wildcards escaped."""
    result: ColumnElement[bool] = column.ilike(
        contains_pattern(value), escape=LIKE_ESCAPE
    )
    return result


SortOrder = Literal["asc", "desc"]


def sort_clauses(column: Any, order: SortOrder, tiebreak: Any) -> tuple[Any, ...]:
    """ORDER BY for an admin table sorted on ``column``: empty values last in
    both directions, and ``tiebreak`` (a unique column) in the same direction,
    so the pages do not overlap."""
    if order == "desc":
        return (nulls_last(column.desc()), tiebreak.desc())
    return (nulls_last(column.asc()), tiebreak.asc())

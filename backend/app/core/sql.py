"""Shared SQL helpers (CF-0050, B51)."""

from typing import Any

from sqlalchemy import ColumnElement

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

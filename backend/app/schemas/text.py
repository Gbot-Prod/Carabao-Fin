"""Clean one-line free text from clients (pin quality, item 6).

Address text goes to riders, receipts, admin pages and SMS. Hidden characters
make two equal addresses look different, hide text, or break a layout:

* control characters (NUL, ESC, ...) are removed; tab and line breaks become
  a space;
* format characters (zero-width space and joiner, BOM, bidi overrides such as
  U+202E), private-use and unassigned code points are removed;
* the text is NFC-normalized, and each run of whitespace (also no-break and
  other Unicode spaces) becomes one space; the ends are stripped.

Use ``one_line`` as a ``mode="before"`` validator, so the length limits apply
to the cleaned text and a value of only hidden characters is empty.
"""

from __future__ import annotations

import unicodedata

# Removed outright. Cc is handled apart (whitespace controls become a space).
_DROP = frozenset({"Cf", "Co", "Cs", "Cn"})


def clean_one_line(value: str) -> str:
    out: list[str] = []
    for char in unicodedata.normalize("NFC", value):
        category = unicodedata.category(char)
        if category == "Cc":
            if char.isspace():
                out.append(" ")
        elif category in ("Zl", "Zp"):
            out.append(" ")
        elif category not in _DROP:
            out.append(char)
    return " ".join("".join(out).split())


def one_line(value: object) -> object:
    """Pydantic ``mode="before"`` validator: clean strings, pass others on."""
    return clean_one_line(value) if isinstance(value, str) else value

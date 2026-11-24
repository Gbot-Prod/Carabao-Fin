"""Read the guardrail word list (Markdown) into ``prohibited_terms`` rows.

The list is ``documentation/plans/carabao_produce_guardrail_wordlist.md``. Its
line ranges set the severity and, for the bad-language block, the category:

* ``hard`` lines (default 3-457): hard blocks. The section heading above a
  word sets its category: contact/payment words -> ``contact``, bad language
  -> ``profanity``, everything else -> ``prohibited_commodity``;
* ``profanity`` lines (default 458-630): hard blocks, ``profanity``;
* ``soft`` lines (default 632 to the end): soft flags. The heading sets the
  category; the default is ``spam``.

The parser accepts the usual Markdown forms: tables (the "term"/"word" column,
or the first text column), bullet and numbered lists, comma lists, and one word
per line. A table column named like "severity", "category" or "language"
overrides the defaults for its row. Prose (long lines without commas),
headings and regular expressions are skipped.

``load`` adds new words only: a word already in the table keeps what an admin
set. Nothing here prints or logs a word; the script prints counts only.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.models.prohibited_term import ProhibitedTerm
from app.services.listing_checks import (
    CATEGORY_CONTACT,
    CATEGORY_PROFANITY,
    CATEGORY_PROHIBITED,
    CATEGORY_SPAM,
    HARD_BLOCK,
    SOFT_FLAG,
    invalidate_terms_cache,
    normalize_term,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_FILES = (
    REPO_ROOT / "documentation" / "plans" / "carabao_produce_guardrail_wordlist.md",
    REPO_ROOT / "documentation" / "manuals" / "carabao_produce_guardrail_wordlist.md",
)
MAX_TERM_WORDS = 6
MAX_TERM_LENGTH = 120


@dataclass(frozen=True)
class Ranges:
    """1-based, inclusive line numbers."""

    hard: tuple[int, int] = (3, 457)
    profanity: tuple[int, int] = (458, 630)
    soft_start: int = 632


@dataclass(frozen=True)
class ParsedTerm:
    term: str
    category: str
    severity: str
    language: str
    line: int


@dataclass
class ParseReport:
    terms: list[ParsedTerm]
    skipped_lines: int
    lines_read: int

    def counts(self) -> Counter[tuple[str, str]]:
        return Counter((t.category, t.severity) for t in self.terms)


_HEADING = re.compile(r"^\s{0,3}#{1,6}\s+(.*)$")
_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(.*)$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")
# Regular expressions and code-like text: the checker's built-in patterns
# cover these.
_REGEX_LIKE = re.compile(r"\\[dDsSwWb]|\(\?|\[[^\]]*-[^\]]*\]|\{\d|\^|\$$")
_LABEL_SPLIT = re.compile(r"\s+[—–-]\s+|:\s+")
_PARENS = re.compile(r"\(([^)]*)\)")
_ITEM_SPLIT = re.compile(r"\s*[,;/]\s*|\s+\|\s+")

_CONTACT_HINTS = re.compile(
    r"contact|payment|pay|social|messag|off.?platform|diver|1\.1\b", re.I
)
_PROFANITY_HINTS = re.compile(
    r"profan|vulgar|offens|insult|sexual|slur|curse|swear|bad language|1\.5\b", re.I
)
_SPAM_HINTS = re.compile(r"spam|format|keyword|caps|emoji|hype|2\.1\b", re.I)
_PROHIBITED_HINTS = re.compile(
    r"prohibit|meat|poultry|seafood|fish|alcohol|chemical|pesticide|animal|"
    r"seedling|plant|drug|illicit|regulat|1\.[234]\b",
    re.I,
)
_LANGUAGES = (
    (re.compile(r"\b(bisaya|cebuano|binisaya|visayan|ceb)\b", re.I), "ceb"),
    (re.compile(r"\b(tagalog|filipino|taglish|tl|fil)\b", re.I), "tl"),
    (re.compile(r"\b(english|en)\b", re.I), "en"),
)
# Cell or word text that names a column or a language, not a term.
_NOT_TERMS = frozenset(
    {
        "term",
        "terms",
        "word",
        "words",
        "keyword",
        "keywords",
        "phrase",
        "example",
        "examples",
        "english",
        "tagalog",
        "filipino",
        "bisaya",
        "cebuano",
        "en",
        "tl",
        "ceb",
        "all",
        "hard block",
        "soft flag",
        "hard",
        "soft",
        "category",
        "language",
        "severity",
        "notes",
        "note",
        "n a",
        "none",
    }
)
_TERM_COLUMN = re.compile(
    r"^(term|word|keyword|phrase|pattern|expression|item|commodity|text|token)", re.I
)


def _language_of(text: str) -> str | None:
    for pattern, code in _LANGUAGES:
        if pattern.search(text):
            return code
    return None


def _category_from(text: str) -> str | None:
    if _PROFANITY_HINTS.search(text):
        return CATEGORY_PROFANITY
    if _CONTACT_HINTS.search(text):
        return CATEGORY_CONTACT
    if _SPAM_HINTS.search(text):
        return CATEGORY_SPAM
    if _PROHIBITED_HINTS.search(text):
        return CATEGORY_PROHIBITED
    return None


def _strip_markup(text: str) -> str:
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links
    text = text.replace("**", "").replace("__", "").replace("`", "")
    text = re.sub(r"(?<!\w)[*_](\S.*?)[*_](?!\w)", r"\1", text)
    return text.strip().strip("\"'“”‘’").strip()


def _clean_term(raw: str) -> str | None:
    raw = _strip_markup(raw)
    if not raw or _REGEX_LIKE.search(raw):
        return None
    term = normalize_term(raw)
    if (
        len(term) < 2
        or len(term) > MAX_TERM_LENGTH
        or term.count(" ") >= MAX_TERM_WORDS
        or not re.search(r"[a-zñ]", term)
        or term in _NOT_TERMS
    ):
        return None
    return term


def _split_items(text: str) -> list[str]:
    return [p for p in _ITEM_SPLIT.split(text) if p.strip()]


def _terms_from_text(text: str) -> list[str]:
    """Terms in a list item or a plain line; [] for prose."""
    text = _strip_markup(text)
    if not text:
        return []
    extra: list[str] = []
    for inner in _PARENS.findall(text):
        # "(baboy)" is another name; "(Tagalog)" or a long note is not.
        if _language_of(inner) is None and len(inner.split()) <= 3:
            extra += _split_items(inner)
    text = _PARENS.sub(" ", text).strip()
    parts = _LABEL_SPLIT.split(text, maxsplit=1)
    if len(parts) == 2:
        left, right = parts
        if len(left.split()) <= 3 and ("," in right or ";" in right):
            body = right  # "Label: word, word, word"
        else:
            body = left  # "word — what it means"
    else:
        body = text
    items = _split_items(body)
    if len(items) == 1 and len(items[0].split()) > MAX_TERM_WORDS:
        return []  # a sentence, not a word
    return items + extra


def _table_cells(line: str) -> list[str]:
    inner = line.strip()
    if inner.startswith("|"):
        inner = inner[1:]
    if inner.endswith("|"):
        inner = inner[:-1]
    return [c.strip() for c in inner.split("|")]


def _severity_for(line_no: int, ranges: Ranges) -> str | None:
    if ranges.hard[0] <= line_no <= ranges.hard[1]:
        return HARD_BLOCK
    if ranges.profanity[0] <= line_no <= ranges.profanity[1]:
        return HARD_BLOCK
    if line_no >= ranges.soft_start:
        return SOFT_FLAG
    return None


def parse(text: str, ranges: Ranges | None = None) -> ParseReport:
    ranges = ranges or Ranges()
    lines = text.splitlines()
    heading_category: str | None = None
    heading_language: str | None = None
    in_fence = False
    header: list[str] | None = None
    terms: list[ParsedTerm] = []
    skipped = 0

    for index, line in enumerate(lines):
        line_no = index + 1
        stripped = line.strip()
        if _FENCE.match(stripped):
            in_fence = not in_fence
            continue
        heading = None if in_fence else _HEADING.match(line)
        if heading:
            title = heading.group(1)
            heading_category = _category_from(title)
            heading_language = _language_of(title)
            header = None
            continue
        if not stripped or stripped.startswith(("---", "***", "___", ">")):
            if not stripped:
                header = None
            continue
        severity = _severity_for(line_no, ranges)
        if severity is None:
            continue
        in_profanity = ranges.profanity[0] <= line_no <= ranges.profanity[1]

        row_category: str | None = None
        row_language: str | None = None
        row_severity: str | None = None
        raw_items: list[str]
        if stripped.startswith("|") and not in_fence:
            if _TABLE_SEP.match(stripped):
                continue
            cells = _table_cells(stripped)
            next_line = lines[index + 1].strip() if index + 1 < len(lines) else ""
            if _TABLE_SEP.match(next_line):
                header = [c.lower() for c in cells]
                continue
            term_col = None
            if header:
                for i, name in enumerate(header):
                    if i < len(cells) and _TERM_COLUMN.match(name):
                        term_col = i
                        break
                for i, name in enumerate(header):
                    if i >= len(cells) or i == term_col:
                        continue
                    if "lang" in name:
                        row_language = _language_of(cells[i])
                    elif "sever" in name or "action" in name or "rule" in name:
                        value = cells[i].lower()
                        if "soft" in value or "flag" in value:
                            row_severity = SOFT_FLAG
                        elif "hard" in value or "block" in value:
                            row_severity = HARD_BLOCK
                    elif "categ" in name or "type" in name or "group" in name:
                        row_category = _category_from(cells[i])
            if term_col is None:
                term_col = next(
                    (
                        i
                        for i, c in enumerate(cells)
                        if c and not re.fullmatch(r"[#\d.\s]+", c)
                    ),
                    None,
                )
            if term_col is None:
                skipped += 1
                continue
            raw_items = _split_items(_PARENS.sub(" ", cells[term_col]))
            raw_items += [
                p
                for inner in _PARENS.findall(cells[term_col])
                if _language_of(inner) is None
                for p in _split_items(inner)
            ]
        else:
            bullet = _BULLET.match(line)
            body = bullet.group(1) if bullet else stripped
            if not bullet and "," not in body and len(body.split()) > 3:
                skipped += 1  # prose
                continue
            raw_items = _terms_from_text(body)
            row_language = _language_of(" ".join(_PARENS.findall(body)))

        if in_profanity:
            category = CATEGORY_PROFANITY
        elif row_category:
            category = row_category
        elif heading_category:
            category = heading_category
        else:
            category = CATEGORY_PROHIBITED if severity == HARD_BLOCK else CATEGORY_SPAM
        found = False
        for raw in raw_items:
            term = _clean_term(raw)
            if term is None:
                continue
            found = True
            terms.append(
                ParsedTerm(
                    term=term,
                    category=category,
                    severity=row_severity or severity,
                    language=row_language or heading_language or "all",
                    line=line_no,
                )
            )
        if not found:
            skipped += 1
    return ParseReport(
        terms=_dedupe(terms), skipped_lines=skipped, lines_read=len(lines)
    )


def _dedupe(terms: Iterable[ParsedTerm]) -> list[ParsedTerm]:
    """One row per term. A hard block wins over a soft flag for the same word."""
    best: dict[str, ParsedTerm] = {}
    for t in terms:
        kept = best.get(t.term)
        if kept is None or (kept.severity == SOFT_FLAG and t.severity == HARD_BLOCK):
            best[t.term] = t
    return list(best.values())


def default_file() -> Path:
    for path in DEFAULT_FILES:
        if path.exists():
            return path
    return DEFAULT_FILES[0]


@dataclass
class LoadResult:
    added: Counter[tuple[str, str]]
    already_present: int


def load(db: Session, report: ParseReport) -> LoadResult:
    """Add the words that are not in the table yet; commit."""
    existing = {t for (t,) in db.query(ProhibitedTerm.term).all()}
    added: Counter[tuple[str, str]] = Counter()
    present = 0
    for t in report.terms:
        if t.term in existing:
            present += 1
            continue
        db.add(
            ProhibitedTerm(
                term=t.term,
                category=t.category,
                severity=t.severity,
                language=t.language,
                is_active=True,
            )
        )
        existing.add(t.term)
        added[(t.category, t.severity)] += 1
    db.commit()
    invalidate_terms_cache(db)
    return LoadResult(added=added, already_present=present)

"""Guardrails Phase 1: reading the word list into prohibited_terms.

The real list has offensive words, so these tests use a made-up list in the
same Markdown forms. Line numbers matter: they set the severity.
"""

from app.models.prohibited_term import ProhibitedTerm
from app.services import term_list
from app.services.listing_checks import (
    CATEGORY_CONTACT,
    CATEGORY_PROFANITY,
    CATEGORY_PROHIBITED,
    CATEGORY_SPAM,
    HARD_BLOCK,
    SOFT_FLAG,
)

LIST = """\
# Word list
Intro text that explains the list and is long enough to be prose.
## Part 1.1 Contact and payment
- fb page
- **pm me** — asks the buyer to message outside
## Part 1.2 Meat and seafood (Tagalog)
| # | Term | Language | Notes |
|---|------|----------|-------|
| 1 | baboy (pork) | Tagalog | meat |
| 2 | `isda` | Tagalog | fish |
Meat words: baka, manok, hipon
## Part 1.5 Bad language
- zorbleck
## Part 2.1 Spam
- best deal
- `\\d{11}`
| Term | Severity |
|------|----------|
| limited stock | hard block |
"""


def _ranges():
    # Lines 3-12: hard, 13-14: bad language, 15 on: soft.
    return term_list.Ranges(hard=(3, 12), profanity=(13, 14), soft_start=15)


def _by_term(report):
    return {t.term: t for t in report.terms}


def test_parse_reads_tables_bullets_and_comma_lists():
    terms = _by_term(term_list.parse(LIST, _ranges()))
    assert terms["fb page"].category == CATEGORY_CONTACT
    assert terms["pm me"].category == CATEGORY_CONTACT
    assert terms["pm me"].severity == HARD_BLOCK
    for word in ("baboy", "pork", "isda", "baka", "manok", "hipon"):
        assert terms[word].category == CATEGORY_PROHIBITED, word
        assert terms[word].severity == HARD_BLOCK
    assert terms["baboy"].language == "tl"
    assert terms["zorbleck"].category == CATEGORY_PROFANITY
    assert terms["best deal"].severity == SOFT_FLAG
    assert terms["best deal"].category == CATEGORY_SPAM
    # A severity column overrides the line range.
    assert terms["limited stock"].severity == HARD_BLOCK


def test_parse_skips_headings_prose_patterns_and_column_names():
    terms = _by_term(term_list.parse(LIST, _ranges()))
    assert "word list" not in terms
    assert not any("intro" in t for t in terms)
    assert not any("asks the buyer" in t for t in terms)
    assert not any("11" in t for t in terms)
    assert "tagalog" not in terms
    assert "meat" not in terms  # the Notes column


def test_load_adds_new_words_only(db):
    db.add(
        ProhibitedTerm(
            term="isda",
            category=CATEGORY_PROHIBITED,
            severity=SOFT_FLAG,
            is_active=False,
        )
    )
    db.commit()
    report = term_list.parse(LIST, _ranges())
    result = term_list.load(db, report)
    assert result.already_present == 1
    kept = db.query(ProhibitedTerm).filter_by(term="isda").one()
    assert kept.severity == SOFT_FLAG and kept.is_active is False
    assert db.query(ProhibitedTerm).count() == len(report.terms)
    # Loading again changes nothing.
    again = term_list.load(db, report)
    assert sum(again.added.values()) == 0

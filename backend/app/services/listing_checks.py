"""The listing checker shared by every client (produce guardrails Phase 1).

``POST /produce/check`` runs it while the merchant types; ``POST /produce/``
and ``PATCH /produce/{id}`` run it again, so no client can skip it.

Two kinds of result:

* a **hard block** (the checker is almost always right): the save is refused
  with 400 ``FieldErrors``, one message per field;
* a **soft flag** (the checker is not sure): the save is accepted, the listing
  goes to ``under_review`` and an admin approves or rejects it.

Checks in Phase 1: contact details and off-platform payment, words from the
``prohibited_terms`` table (prohibited items, bad language, spam terms),
keyword spam, category mismatch, unknown produce (only with real reference
data), dates and shelf life, price tiers, and duplicate listings.

Phase 4: a photo like the photo of another farm's listing (``image_phash``,
see ``photo_checks``), and a price per kg far below or far above the market
reference price. The price flags use only real (not SAMPLE) rows that are at
most ``REFERENCE_MAX_AGE_DAYS`` old, so they stay off until real DA data is
loaded. The QR code block is on the upload route (``photo_checks``); the
vision check (``listing_vision``) runs after the save.

A message never repeats a bad-language word back to the merchant.
"""

from __future__ import annotations

import re
import time
import unicodedata
import weakref
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models.produce import Produce
from app.models.prohibited_term import ProhibitedTerm
from app.models.reference_price import ReferencePrice
from app.models.statuses import ProduceStatus
from app.schemas.produce import PriceTier
from app.services import reference_prices
from app.services.produce_pricing import pricing_error

HARD_BLOCK = "hard_block"
SOFT_FLAG = "soft_flag"
SEVERITIES = (HARD_BLOCK, SOFT_FLAG)

CATEGORY_CONTACT = "contact"
CATEGORY_PROHIBITED = "prohibited_commodity"
CATEGORY_PROFANITY = "profanity"
CATEGORY_SPAM = "spam"
TERM_CATEGORIES = (
    CATEGORY_CONTACT,
    CATEGORY_PROHIBITED,
    CATEGORY_PROFANITY,
    CATEGORY_SPAM,
)
LANGUAGES = ("en", "tl", "ceb", "all")

# Codes the clients can rely on (web + mobile show the message; the code is
# for tests and analytics).
CONTACT_INFO_DETECTED = "CONTACT_INFO_DETECTED"
OFF_PLATFORM_PAYMENT = "OFF_PLATFORM_PAYMENT"
PAYMENT_MENTION = "PAYMENT_MENTION"
PROHIBITED_ITEM = "PROHIBITED_ITEM"
BAD_LANGUAGE = "BAD_LANGUAGE"
FLAGGED_TERM = "FLAGGED_TERM"
KEYWORD_REPETITION = "KEYWORD_REPETITION"
ALL_CAPS = "ALL_CAPS"
EMOJI_OVERLOAD = "EMOJI_OVERLOAD"
COMMA_LIST = "COMMA_LIST"
UNKNOWN_COMMODITY = "UNKNOWN_COMMODITY"
CATEGORY_MISMATCH = "CATEGORY_MISMATCH"
DATES_REQUIRED = "DATES_REQUIRED"
FUTURE_HARVEST_DATE = "FUTURE_HARVEST_DATE"
BEST_BEFORE_BEFORE_HARVEST = "BEST_BEFORE_BEFORE_HARVEST"
EXCESSIVE_SHELF_LIFE = "EXCESSIVE_SHELF_LIFE"
INVALID_PRICE_TIER = "INVALID_PRICE_TIER"
DUPLICATE_LISTING = "DUPLICATE_LISTING"
# Phase 4
POSSIBLE_STOLEN_PHOTO = "POSSIBLE_STOLEN_PHOTO"
PRICE_TOO_LOW = "PRICE_TOO_LOW"
PRICE_TOO_HIGH = "PRICE_TOO_HIGH"

# Price flags (Phase 4): the price per kg against the reference low/high.
PRICE_LOW_SHARE = 0.5  # below 0.5 x low: a bait price such as 1 peso
PRICE_HIGH_SHARE = 2.5  # above 2.5 x high: usually a typing error
REFERENCE_MAX_AGE_DAYS = 45
KG_PER_LB = 0.45359237

# An admin's reason for a rejection (POST /admin/produce/{id}/reject).
REJECTION_CODES: dict[str, str] = {
    "INCORRECT_CATEGORY": "The listing is in the wrong category.",
    "MISLEADING_PHOTO": "The photo does not show the produce in the listing.",
    "UNREALISTIC_PRICE": "The price is not realistic for this produce.",
    "PROHIBITED_COMMODITY": "This item cannot be sold on Carabao.",
    "CONTACT_INFO": "The listing has contact or payment details.",
    "SPAM": "The name or description has keyword spam.",
    "OTHER": "Other reason.",
}
REJECTION_NOTE_MIN = 10
REJECTION_NOTE_MAX = 500


@dataclass(frozen=True)
class Issue:
    field: str
    code: str
    message: str
    # A value the client can apply with one tap (CATEGORY_MISMATCH: "Fruits").
    suggestion: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class CheckResult:
    hard_blocks: list[Issue] = field(default_factory=list)
    soft_flags: list[Issue] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.hard_blocks

    @property
    def recommended_status(self) -> ProduceStatus:
        return ProduceStatus.UNDER_REVIEW if self.soft_flags else ProduceStatus.LIVE

    def field_errors(self) -> dict[str, str]:
        """The hard blocks as {field: message}, for ``FieldErrors``."""
        errors: dict[str, str] = {}
        for issue in self.hard_blocks:
            shown = errors.get(issue.field)
            if shown is None:
                errors[issue.field] = issue.message
            elif issue.message not in shown:
                errors[issue.field] = f"{shown} {issue.message}"
        return errors

    def flags_json(self) -> list[dict[str, Any]]:
        return [issue.as_dict() for issue in self.soft_flags]


@dataclass(frozen=True)
class ListingInput:
    """The fields the checker reads. ``None`` means "not given" (POST /check)."""

    name: str | None = None
    description: str | None = None
    category: str | None = None
    price: int | None = None
    unit: str | None = None
    unit_quantity: float | None = None
    stock_quantity: int | None = None
    harvest_date: date | None = None
    best_before: date | None = None
    min_order_qty: int | None = None
    price_tiers: Sequence[PriceTier] = ()
    # Phase 4: the pHash of the saved photo (photo_checks.phash).
    image_phash: int | None = None


@dataclass(frozen=True)
class Term:
    term: str
    category: str
    severity: str


# ---------------------------------------------------------------------------
# Text normalization
# ---------------------------------------------------------------------------

_LEET = str.maketrans(
    {
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "7": "t",
        "8": "b",
        "@": "a",
        "$": "s",
        "!": "i",
        "|": "i",
    }
)
_NON_WORD = re.compile(r"[^0-9a-zñ]+")
# "g c a s h" or "g.c.a.s.h": three or more single letters in a row.
_SPACED_LETTERS = re.compile(r"\b(?:[a-zñ] ){2,}[a-zñ]\b")
_MAX_NGRAM = 6


def normalize_term(text: str) -> str:
    """Lower case, accents removed (ñ kept), words separated by one space."""
    text = unicodedata.normalize("NFKC", text).lower().replace("ñ", "\x00")
    text = "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    ).replace("\x00", "ñ")
    return _NON_WORD.sub(" ", text).strip()


def _join_spaced(normalized: str) -> str:
    return _SPACED_LETTERS.sub(lambda m: m.group(0).replace(" ", ""), normalized)


def _variants(text: str) -> tuple[list[str], list[str]]:
    """The ways a word can hide: (as typed, letters spaced out), (leetspeak).

    The first list is for contact words; the second adds leetspeak for the
    word table. Leetspeak is not used for contact words: "5 pm" is a time.
    """
    plain = normalize_term(text)
    leet = normalize_term(unicodedata.normalize("NFKC", text).lower().translate(_LEET))
    typed = list(dict.fromkeys([plain, _join_spaced(plain)]))
    hidden = list(dict.fromkeys([leet, _join_spaced(leet)]))
    return typed, [v for v in hidden if v not in typed]


def _ngrams(normalized: str) -> set[str]:
    words = normalized.split()
    grams: set[str] = set()
    for size in range(1, _MAX_NGRAM + 1):
        for start in range(0, len(words) - size + 1):
            grams.add(" ".join(words[start : start + size]))
    return grams


class _Text:
    """One field's text, prepared once for every term lookup."""

    def __init__(self, raw: str) -> None:
        self.raw = raw
        self.typed, leet = _variants(raw)
        self.variants = self.typed + leet
        self.typed_grams: set[str] = set()
        for v in self.typed:
            self.typed_grams |= _ngrams(v)
        self.grams = set(self.typed_grams)
        for v in leet:
            self.grams |= _ngrams(v)

    def has(self, term: str, *, leet: bool = True) -> bool:
        """Whether ``term`` (normalized) is in the text as whole words."""
        if term.count(" ") < _MAX_NGRAM:
            return term in (self.grams if leet else self.typed_grams)
        variants = self.variants if leet else self.typed
        return any(f" {term} " in f" {v} " for v in variants)


# ---------------------------------------------------------------------------
# Contact details and off-platform payment (built in; the table adds more)
# ---------------------------------------------------------------------------

_EMAIL = re.compile(r"[\w.+-]+\s*(?:@|\(at\)|\[at\])\s*[\w-]+(?:\.[\w-]+)+", re.I)
_URL = re.compile(
    r"(?:https?://|www\.)\S+"
    r"|\b[a-z0-9-]+\.(?:com|ph|net|org|me|co|io|ly|app|shop|store|xyz|page|link)\b"
    r"|\bm\.me/\S*",
    re.I,
)
# A run of digits and separators; checked as a phone number once the
# separators are removed.
_DIGIT_RUN = re.compile(r"\+?\d[\d\s.\-()/]{7,}\d")
_PHONE_DIGITS = re.compile(r"^(?:(?:63|0)9\d{9}|9\d{9}|0[2-8]\d{7,8})$")
_NUMBER_WORDS = {
    # English
    "zero",
    "oh",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    # Tagalog
    "wala",
    "isa",
    "dalawa",
    "tatlo",
    "apat",
    "lima",
    "anim",
    "pito",
    "walo",
    "siyam",
    # Bisaya
    "usa",
    "duha",
    "tulo",
    "upat",
    "unom",
}
# Social and messaging words: whole words after normalization.
_SOCIAL_TERMS = (
    "facebook",
    "fb",
    "fb page",
    "fbpage",
    "messenger",
    "viber",
    "telegram",
    "whatsapp",
    "instagram",
    "tiktok",
    "wechat",
    "pm me",
    "dm me",
    "dm",
    "message me",
    "msg me",
    "text me",
    "txt me",
    "call me",
    "chat me",
    "contact me",
    "add me",
    "i pm",
    "ipm",
    "i text",
    "itext",
    "tawagan",
)
# "pm" is a contact word, but not after a number ("5 pm" is a time).
_PM = re.compile(r"(?<![0-9] )(?<![0-9])\bpm\b")
# Payment outside the platform: always a hard block.
_PAYMENT_PHRASES = (
    "gcash me",
    "gcash mo",
    "gcash number",
    "gcash no",
    "gcash num",
    "via gcash",
    "thru gcash",
    "through gcash",
    "send gcash",
    "sa gcash",
    "gcash lang",
    "gcash only",
    "maya me",
    "via maya",
    "via paymaya",
    "bank transfer",
    "direct transfer",
    "direct payment",
    "pay direct",
    "pay directly",
    "kaliwaan",
    "meetup",
    "meet up",
    "meet-up",
    "cod outside",
    "send payment to",
    "deposit to",
    "bayad sa labas",
    "palawan express",
    "cebuana lhuillier",
    "western union",
)
# A payment name alone: maybe innocent, so a soft flag only.
_PAYMENT_NAMES = (
    "gcash",
    "maya",
    "paymaya",
    "bdo",
    "bpi",
    "metrobank",
    "landbank",
    "unionbank",
    "coins ph",
    "remittance",
    "padala",
)


def _number_word_run(normalized: str) -> bool:
    """Seven or more digits in a row, three or more of them written as words.

    Plain digits are left to the phone pattern: "100 150 200" is a price list.
    """
    run = words = 0
    for word in normalized.split():
        if word in _NUMBER_WORDS or (word.isdigit() and len(word) == 1):
            run += 1
            words += word in _NUMBER_WORDS
            if run >= 7 and words >= 3:
                return True
        else:
            run = words = 0
    return False


def _has_phone(raw: str) -> bool:
    for match in _DIGIT_RUN.finditer(raw):
        digits = re.sub(r"\D", "", match.group(0))
        if _PHONE_DIGITS.match(digits):
            return True
    return False


def _contact_issues(field_name: str, text: _Text) -> list[Issue]:
    issues: list[Issue] = []
    raw = text.raw
    found: list[str] = []
    if _has_phone(raw) or any(_number_word_run(v) for v in text.typed):
        found.append("a phone number")
    if _EMAIL.search(raw):
        found.append("an email address")
    if _URL.search(raw):
        found.append("a link")
    if any(text.has(t, leet=False) for t in _SOCIAL_TERMS) or any(
        _PM.search(v) for v in text.typed
    ):
        found.append("a social media or messaging contact")
    if found:
        issues.append(
            Issue(
                field_name,
                CONTACT_INFO_DETECTED,
                f"Remove {_join(found)}. Buyers contact you through Carabao chat only.",
            )
        )
    if any(text.has(normalize_term(p), leet=False) for p in _PAYMENT_PHRASES):
        issues.append(
            Issue(
                field_name,
                OFF_PLATFORM_PAYMENT,
                "Remove the payment instructions. Buyers pay through Carabao "
                "checkout only.",
            )
        )
    return issues


CHAT_CONTACT_MESSAGE = (
    "Remove the phone number, email, link or social media contact. Keep the "
    "talk in Carabao chat, so that we can help if there is a problem."
)
CHAT_PAYMENT_MESSAGE = (
    "Remove the payment instructions. Buyers pay through Carabao checkout only."
)


def chat_message_problem(body: str) -> str | None:
    """Why a buyer or farm chat message is refused (guardrails Phase 3).

    The same contact and off-platform payment check as listing text, so that
    a merchant cannot move the sale out of Carabao through chat.
    """
    codes = {issue.code for issue in _contact_issues("message", _Text(body))}
    if CONTACT_INFO_DETECTED in codes:
        return CHAT_CONTACT_MESSAGE
    if OFF_PLATFORM_PAYMENT in codes:
        return CHAT_PAYMENT_MESSAGE
    return None


def _payment_mention(field_name: str, text: _Text) -> Issue | None:
    names = [p for p in _PAYMENT_NAMES if text.has(p, leet=False)]
    if not names:
        return None
    return Issue(
        field_name,
        PAYMENT_MENTION,
        "The text names a payment method. An admin will check that it does "
        "not ask buyers to pay outside Carabao.",
    )


def _join(parts: list[str]) -> str:
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


# ---------------------------------------------------------------------------
# Words from the prohibited_terms table
# ---------------------------------------------------------------------------


def _term_issues(field_name: str, text: _Text, terms: Iterable[Term]) -> list[Issue]:
    hits: dict[tuple[str, str], list[str]] = {}
    for term in terms:
        if term.term and text.has(term.term):
            hits.setdefault((term.category, term.severity), []).append(term.term)
    issues: list[Issue] = []
    for (category, severity), words in hits.items():
        quoted = ", ".join(f"'{w}'" for w in sorted(set(words))[:3])
        if category == CATEGORY_PROFANITY:
            code, message = (
                BAD_LANGUAGE,
                "Remove the offensive language."
                if severity == HARD_BLOCK
                else "The text may have offensive language. An admin will check it.",
            )
        elif category == CATEGORY_PROHIBITED:
            code, message = (
                PROHIBITED_ITEM,
                f"Carabao sells fresh produce only. These cannot be listed: {quoted}."
                if severity == HARD_BLOCK
                else f"An admin will check that this is allowed produce: {quoted}.",
            )
        elif category == CATEGORY_CONTACT:
            code, message = (
                CONTACT_INFO_DETECTED,
                f"Remove the contact or payment details: {quoted}. Buyers use "
                "Carabao chat and checkout only."
                if severity == HARD_BLOCK
                else f"An admin will check these words: {quoted}.",
            )
        else:
            code, message = (
                FLAGGED_TERM,
                f"Remove these words: {quoted}."
                if severity == HARD_BLOCK
                else f"An admin will check these words: {quoted}.",
            )
        issues.append(Issue(field_name, code, message))
    return issues


_terms_cache: weakref.WeakKeyDictionary[Any, tuple[float, list[Term]]] = (
    weakref.WeakKeyDictionary()
)
TERMS_CACHE_SECONDS = 60.0


def active_terms(db: Session) -> list[Term]:
    """The active rows of ``prohibited_terms``, cached for a minute per engine."""
    bind = db.get_bind()
    now = time.monotonic()
    cached = _terms_cache.get(bind)
    if cached and now - cached[0] < TERMS_CACHE_SECONDS:
        return cached[1]
    rows = (
        db.query(ProhibitedTerm.term, ProhibitedTerm.category, ProhibitedTerm.severity)
        .filter(ProhibitedTerm.is_active.is_(True))
        .all()
    )
    terms = [Term(normalize_term(t), c, s) for t, c, s in rows]
    _terms_cache[bind] = (now, terms)
    return terms


def invalidate_terms_cache(db: Session | None = None) -> None:
    if db is None:
        _terms_cache.clear()
    else:
        _terms_cache.pop(db.get_bind(), None)


# ---------------------------------------------------------------------------
# Keyword spam (soft flags)
# ---------------------------------------------------------------------------

_EMOJI = re.compile("[\U0001f300-\U0001faff\U0001f1e6-\U0001f1ff☀-➿⬀-⯿]")
# Name: a word 3 times. Description: 5 times and a fifth of all words.
NAME_REPEAT_LIMIT = 3
REPEAT_LIMIT = 5
REPEAT_SHARE = 0.2
# Small words every sentence has; never counted as keyword spam.
_STOPWORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "from",
        "this",
        "that",
        "are",
        "our",
        "you",
        "your",
        "per",
        "fresh",
        "ang",
        "mga",
        "ng",
        "sa",
        "na",
        "at",
        "ay",
        "para",
        "may",
        "kami",
        "namin",
        "nga",
        "kag",
        "ug",
        "kay",
        "mao",
        "ini",
        "iyang",
        "among",
    }
)
CAPS_MIN_LENGTH = 15
CAPS_SHARE = 0.7
EMOJI_PER_50 = 3
NAME_COMMA_ITEMS = 4
DESCRIPTION_COMMA_ITEMS = 8


def _spam_issues(field_name: str, raw: str) -> list[Issue]:
    issues: list[Issue] = []
    all_words = normalize_term(raw).split()
    words = [
        w for w in all_words if len(w) >= 3 and w.isalpha() and w not in _STOPWORDS
    ]
    if field_name == "name":
        repeated = [w for w, n in Counter(words).items() if n >= NAME_REPEAT_LIMIT]
    else:
        repeated = [
            w
            for w, n in Counter(words).items()
            if n >= REPEAT_LIMIT and n / max(1, len(all_words)) >= REPEAT_SHARE
        ]
    if repeated:
        issues.append(
            Issue(
                field_name,
                KEYWORD_REPETITION,
                f"'{repeated[0]}' is repeated many times. Write each word once.",
            )
        )
    if field_name == "name" and len(raw.strip()) > CAPS_MIN_LENGTH:
        letters = [c for c in raw if c.isalpha()]
        upper = sum(1 for c in letters if c.isupper())
        if len(letters) >= 8 and upper / len(letters) >= CAPS_SHARE:
            issues.append(
                Issue(field_name, ALL_CAPS, "Do not write the name in capital letters.")
            )
    emoji = len(_EMOJI.findall(raw))
    allowed = EMOJI_PER_50 * max(1, -(-len(raw) // 50))
    if emoji > allowed:
        issues.append(Issue(field_name, EMOJI_OVERLOAD, "Use fewer emoji."))
    limit = NAME_COMMA_ITEMS if field_name == "name" else DESCRIPTION_COMMA_ITEMS
    for sentence in re.split(r"[.!?\n]+", raw):
        items = [p for p in sentence.split(",") if p.strip()]
        if len(items) > limit:
            issues.append(
                Issue(
                    field_name,
                    COMMA_LIST,
                    "The text is a long list of keywords. Describe the produce "
                    "in sentences.",
                )
            )
            break
    return issues


# ---------------------------------------------------------------------------
# Produce match and category
# ---------------------------------------------------------------------------

# Common names (English, Tagalog, Bisaya) of produce sold as fruit or as a
# vegetable in Philippine markets. Used only for CATEGORY_MISMATCH.
FRUIT_WORDS = frozenset(
    {
        "mango",
        "mangga",
        "banana",
        "saging",
        "saba",
        "lakatan",
        "latundan",
        "pineapple",
        "pinya",
        "papaya",
        "watermelon",
        "pakwan",
        "melon",
        "orange",
        "dalandan",
        "pomelo",
        "suha",
        "calamansi",
        "kalamansi",
        "lemon",
        "lime",
        "dayap",
        "avocado",
        "abokado",
        "guava",
        "bayabas",
        "jackfruit",
        "langka",
        "durian",
        "lanzones",
        "rambutan",
        "mangosteen",
        "chico",
        "santol",
        "atis",
        "guyabano",
        "soursop",
        "star apple",
        "caimito",
        "kaimito",
        "duhat",
        "macopa",
        "dragon fruit",
        "grapes",
        "ubas",
        "apple",
        "mansanas",
        "strawberry",
        "coconut",
        "niyog",
        "buko",
        "tamarind",
        "sampalok",
        "sampaloc",
        "marang",
        "mabolo",
        "pomegranate",
        "passion fruit",
        "pear",
        "peras",
        "kiwi",
    }
)
VEGETABLE_WORDS = frozenset(
    {
        "talong",
        "eggplant",
        "ampalaya",
        "bitter gourd",
        "kamatis",
        "tomato",
        "sibuyas",
        "onion",
        "bawang",
        "garlic",
        "repolyo",
        "cabbage",
        "pechay",
        "petsay",
        "bok choy",
        "kangkong",
        "spinach",
        "lettuce",
        "letsugas",
        "carrot",
        "karot",
        "potato",
        "patatas",
        "kamote",
        "sweet potato",
        "gabi",
        "taro",
        "ube",
        "cassava",
        "kamoteng kahoy",
        "radish",
        "labanos",
        "okra",
        "sitaw",
        "string beans",
        "patola",
        "upo",
        "kalabasa",
        "squash",
        "pumpkin",
        "sayote",
        "chayote",
        "malunggay",
        "moringa",
        "mustasa",
        "mustard",
        "luya",
        "ginger",
        "sili",
        "chili",
        "siling",
        "bell pepper",
        "cucumber",
        "pipino",
        "corn",
        "mais",
        "bataw",
        "sigarilyas",
        "winged bean",
        "broccoli",
        "cauliflower",
        "celery",
        "kintsay",
        "baguio beans",
        "green beans",
        "togue",
        "mung bean",
        "monggo",
        "mushroom",
        "kabute",
        "alugbati",
        "saluyot",
        "camote tops",
        "talbos",
        "leeks",
        "spring onion",
        "dahon",
        "tanglad",
        "lemongrass",
    }
)
# Shelf life: the longest believable time from harvest to best-before.
LEAFY_WORDS = frozenset(
    {
        "lettuce",
        "letsugas",
        "pechay",
        "petsay",
        "bok choy",
        "kangkong",
        "spinach",
        "malunggay",
        "moringa",
        "mustasa",
        "alugbati",
        "saluyot",
        "camote tops",
        "talbos",
        "celery",
        "kintsay",
        "spring onion",
        "leeks",
        "togue",
        "mushroom",
        "kabute",
        "strawberry",
        "dahon",
        "herbs",
        "basil",
    }
)
LONG_KEEPING_WORDS = frozenset(
    {
        "sibuyas",
        "onion",
        "bawang",
        "garlic",
        "potato",
        "patatas",
        "kamote",
        "sweet potato",
        "gabi",
        "taro",
        "ube",
        "cassava",
        "kamoteng kahoy",
        "luya",
        "ginger",
        "kalabasa",
        "squash",
        "pumpkin",
        "coconut",
        "niyog",
        "tamarind",
        "sampalok",
        "sampaloc",
        "monggo",
        "mung bean",
        "carrot",
        "karot",
    }
)
SHELF_LIFE_LEAFY_DAYS = 14
SHELF_LIFE_DEFAULT_DAYS = 30
SHELF_LIFE_LONG_DAYS = 90


def _words_in(grams: set[str], words: frozenset[str]) -> bool:
    return any(w in grams for w in words)


def _category_issue(name: str, category: str | None) -> Issue | None:
    if category not in ("Vegetables", "Fruits"):
        return None
    grams = _ngrams(normalize_term(name))
    fruit = _words_in(grams, FRUIT_WORDS)
    vegetable = _words_in(grams, VEGETABLE_WORDS)
    if category == "Vegetables" and fruit and not vegetable:
        return Issue(
            "category",
            CATEGORY_MISMATCH,
            "This looks like a fruit. Put it under Fruits.",
            suggestion="Fruits",
        )
    if category == "Fruits" and vegetable and not fruit:
        return Issue(
            "category",
            CATEGORY_MISMATCH,
            "This looks like a vegetable. Put it under Vegetables.",
            suggestion="Vegetables",
        )
    return None


def max_shelf_life_days(name: str | None) -> int:
    grams = _ngrams(normalize_term(name or ""))
    if _words_in(grams, LEAFY_WORDS):
        return SHELF_LIFE_LEAFY_DAYS
    if _words_in(grams, LONG_KEEPING_WORDS):
        return SHELF_LIFE_LONG_DAYS
    return SHELF_LIFE_DEFAULT_DAYS


def _date_issues(
    listing: ListingInput, today: date, require_dates: bool
) -> list[Issue]:
    issues: list[Issue] = []
    harvest, best = listing.harvest_date, listing.best_before
    if require_dates and harvest is None and best is None:
        # One message, the same text as before the checker (freshness_error).
        issues.append(
            Issue(
                "harvest_date",
                DATES_REQUIRED,
                "Harvest date and best-before date are required",
            )
        )
    elif require_dates:
        if harvest is None:
            issues.append(
                Issue("harvest_date", DATES_REQUIRED, "Enter the harvest date.")
            )
        if best is None:
            issues.append(
                Issue("best_before", DATES_REQUIRED, "Enter the best-before date.")
            )
    if harvest is not None and harvest > today:
        issues.append(
            Issue(
                "harvest_date",
                FUTURE_HARVEST_DATE,
                "Harvest date cannot be in the future",
            )
        )
    if harvest is not None and best is not None and best < harvest:
        issues.append(
            Issue(
                "best_before",
                BEST_BEFORE_BEFORE_HARVEST,
                "Best-before date cannot be earlier than the harvest date",
            )
        )
    return issues


def _shelf_life_issue(listing: ListingInput) -> Issue | None:
    harvest, best = listing.harvest_date, listing.best_before
    if harvest is None or best is None or best < harvest:
        return None
    limit = max_shelf_life_days(listing.name)
    if (best - harvest).days > limit:
        return Issue(
            "best_before",
            EXCESSIVE_SHELF_LIFE,
            f"Best-before is more than {limit} days after harvest. An admin "
            "will check the dates.",
        )
    return None


def _tier_issue(listing: ListingInput) -> Issue | None:
    if listing.price is None:
        return None
    error = pricing_error(
        listing.price, listing.min_order_qty or 1, list(listing.price_tiers)
    )
    if error is None:
        return None
    return Issue("price_tiers", INVALID_PRICE_TIER, error)


def _photo_issue(
    listing: ListingInput, other_photo_hashes: Iterable[int]
) -> Issue | None:
    from app.services.photo_checks import PHASH_MAX_DISTANCE, distance

    mine = listing.image_phash
    if mine is None:
        return None
    if any(distance(mine, other) <= PHASH_MAX_DISTANCE for other in other_photo_hashes):
        return Issue(
            "image",
            POSSIBLE_STOLEN_PHOTO,
            "This photo is like the photo of another farm's listing. Use your "
            "own photo of your produce. An admin will check it.",
        )
    return None


def price_per_kg(price: int, unit: str | None, unit_quantity: float | None) -> float:
    """Pesos per kg for a price per sale unit (``unit_quantity`` kg or lbs)."""
    quantity = unit_quantity if unit_quantity and unit_quantity > 0 else 1.0
    kg = quantity * (KG_PER_LB if (unit or "kg").strip().lower() == "lbs" else 1.0)
    return price / kg


def usable_reference_rows(
    rows: Sequence[ReferencePrice], today: date
) -> list[ReferencePrice]:
    """Real (not SAMPLE), per-kg rows at most ``REFERENCE_MAX_AGE_DAYS`` old."""
    return [
        r
        for r in rows
        if not reference_prices.is_sample(r)
        and (r.unit or "kg").strip().lower() == "kg"
        and (today - r.as_of).days <= REFERENCE_MAX_AGE_DAYS
    ]


def _price_issues(
    listing: ListingInput, rows: Sequence[ReferencePrice], today: date
) -> list[Issue]:
    if listing.price is None or not listing.name:
        return []
    usable = usable_reference_rows(rows, today)
    if not usable:
        return []
    row = reference_prices.match(usable, listing.name, "kg")
    if row is None:
        return []
    band = f"market price {row.low}-{row.high} pesos per kg on {row.as_of:%Y-%m-%d}"
    issues: list[Issue] = []
    base = price_per_kg(listing.price, listing.unit, listing.unit_quantity)
    tier_prices = [
        price_per_kg(t.unit_price, listing.unit, listing.unit_quantity)
        for t in listing.price_tiers
    ]
    lowest = min([base, *tier_prices])
    if lowest < PRICE_LOW_SHARE * row.low:
        issues.append(
            Issue(
                "price" if lowest == base else "price_tiers",
                PRICE_TOO_LOW,
                f"The price is much lower than the {band}. Check the price. "
                "An admin will check it.",
            )
        )
    if base > PRICE_HIGH_SHARE * row.high:
        issues.append(
            Issue(
                "price",
                PRICE_TOO_HIGH,
                f"The price is much higher than the {band}. Check for a typing "
                "error. An admin will check it.",
            )
        )
    return issues


def listing_key(name: str | None, unit: str | None) -> tuple[str, str]:
    """What two listings of one farm must not share: normalized name and unit."""
    return (normalize_term(name or ""), (unit or "kg").strip().lower())


# ---------------------------------------------------------------------------
# The checker
# ---------------------------------------------------------------------------


def run_checks(
    listing: ListingInput,
    *,
    terms: Iterable[Term] = (),
    reference_rows: Sequence[ReferencePrice] = (),
    reference_is_real: bool = False,
    other_listings: Iterable[tuple[str | None, str | None]] = (),
    other_photo_hashes: Iterable[int] = (),
    today: date,
    require_dates: bool = False,
) -> CheckResult:
    """Every check on ``listing``. Pure: the caller loads the data.

    ``other_photo_hashes``: the pHashes of other farms' listing photos.
    """
    result = CheckResult()
    terms = list(terms)
    hard_terms = [t for t in terms if t.severity == HARD_BLOCK]
    soft_terms = [t for t in terms if t.severity != HARD_BLOCK]

    for field_name in ("name", "description"):
        raw = getattr(listing, field_name)
        if not raw or not raw.strip():
            continue
        text = _Text(raw)
        result.hard_blocks += _contact_issues(field_name, text)
        result.hard_blocks += _term_issues(field_name, text, hard_terms)
        soft = _term_issues(field_name, text, soft_terms)
        mention = _payment_mention(field_name, text)
        if mention and not any(
            i.code == OFF_PLATFORM_PAYMENT and i.field == field_name
            for i in result.hard_blocks
        ):
            soft.append(mention)
        result.soft_flags += soft + _spam_issues(field_name, raw)

    if listing.name and listing.name.strip():
        mismatch = _category_issue(listing.name, listing.category)
        if mismatch:
            result.soft_flags.append(mismatch)
        if (
            reference_is_real
            and reference_rows
            and reference_prices.match(list(reference_rows), listing.name, listing.unit)
            is None
        ):
            result.soft_flags.append(
                Issue(
                    "name",
                    UNKNOWN_COMMODITY,
                    "We do not know this produce yet. An admin will check it.",
                )
            )
        key = listing_key(listing.name, listing.unit)
        if any(listing_key(n, u) == key for n, u in other_listings):
            result.hard_blocks.append(
                Issue(
                    "name",
                    DUPLICATE_LISTING,
                    "You already have a listing for this produce and unit. "
                    "Edit that listing (for example its stock) instead.",
                )
            )

    result.hard_blocks += _date_issues(listing, today, require_dates)
    shelf = _shelf_life_issue(listing)
    if shelf:
        result.soft_flags.append(shelf)
    tier = _tier_issue(listing)
    if tier:
        result.hard_blocks.append(tier)
    else:
        # A price check on tiers that are not valid would give a second,
        # confusing message about the same numbers.
        result.soft_flags += _price_issues(listing, reference_rows, today)
    photo = _photo_issue(listing, other_photo_hashes)
    if photo:
        result.soft_flags.append(photo)
    return result


def check_listing(
    db: Session,
    listing: ListingInput,
    *,
    merchant_id: int | None,
    exclude_produce_id: int | None = None,
    require_dates: bool = False,
) -> CheckResult:
    """``run_checks`` with the terms, reference prices and the farm's listings."""
    from app.services.produce_freshness import ph_today

    others: list[tuple[str | None, str | None]] = []
    if merchant_id is not None and listing.name:
        query = db.query(Produce.name, Produce.unit).filter(
            Produce.merchant_id == merchant_id
        )
        if exclude_produce_id is not None:
            query = query.filter(Produce.id != exclude_produce_id)
        others = [(n, u) for n, u in query.all()]
    photo_hashes: list[int] = []
    if listing.image_phash is not None:
        # Other farms only: a farm may use its own photo on two listings.
        hashes = db.query(Produce.image_phash).filter(Produce.image_phash.isnot(None))
        if merchant_id is not None:
            hashes = hashes.filter(Produce.merchant_id != merchant_id)
        if exclude_produce_id is not None:
            hashes = hashes.filter(Produce.id != exclude_produce_id)
        photo_hashes = [h for (h,) in hashes.all()]
    rows = db.query(ReferencePrice).all()
    real = bool(rows) and not all(reference_prices.is_sample(r) for r in rows)
    return run_checks(
        listing,
        terms=active_terms(db),
        reference_rows=rows,
        reference_is_real=real,
        other_listings=others,
        other_photo_hashes=photo_hashes,
        today=ph_today(),
        require_dates=require_dates,
    )


def listing_input_from(produce: Produce, tiers: Sequence[PriceTier]) -> ListingInput:
    """The checker's view of a (changed, not yet saved) listing row."""
    return ListingInput(
        name=produce.name,
        description=produce.description,
        category=produce.category,
        price=produce.price,
        unit=produce.unit,
        unit_quantity=produce.unit_quantity,
        stock_quantity=produce.stock_quantity,
        harvest_date=produce.harvest_date,
        best_before=produce.best_before,
        min_order_qty=produce.min_order_qty,
        price_tiers=tuple(tiers),
        image_phash=produce.image_phash,
    )

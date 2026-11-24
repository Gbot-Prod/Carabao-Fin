"""Guardrails Phase 1: the listing checker (services/listing_checks.py).

The word-table tests use made-up words ("zorbleck"), never real bad words.
"""

from datetime import date, timedelta

import pytest

from app.models.reference_price import ReferencePrice
from app.models.statuses import ProduceStatus
from app.schemas.produce import PriceTier
from app.services import listing_checks as lc

TODAY = date(2026, 11, 24)


def _check(**fields):
    options = {
        k: fields.pop(k)
        for k in ("terms", "other_listings", "reference_rows", "reference_is_real")
        if k in fields
    }
    return lc.run_checks(lc.ListingInput(**fields), today=TODAY, **options)


def _codes(issues):
    return {(i.field, i.code) for i in issues}


# --- contact details -------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "Fresh mango 09171234567",
        "Call 0917 123 4567 for bulk",
        "Order at +63 917-123-4567",
        "639171234567 lang",
        "0917.123.4567",
        "zero nine one seven one two three four five six seven",
        "email me: farmer@example.com",
        "farmer (at) example.com",
        "visit www.myfarm.ph",
        "see https://example.com/shop",
        "myfarmshop.com for more",
        "PM me for bulk",
        "pm for price",
        "Message me on FB",
        "Add me on Viber",
        "Find us on Facebook",
        "dm for orders",
        "whatsapp only",
    ],
)
def test_contact_details_are_hard_blocks(text):
    result = _check(name="Mangga", description=text)
    assert ("description", lc.CONTACT_INFO_DETECTED) in _codes(result.hard_blocks)
    assert not result.valid


@pytest.mark.parametrize(
    "text",
    [
        "Harvested at 5 PM, delivered next morning",
        "Pick-up from 8 am to 5pm",
        "Prices: 100 150 200 per kg",
        "1.5 kg per pack, 10 packs available",
        "Harvested 2026/11/20",
        "Fresh. Me and my family grow it",
        "Isa sa pinakamatamis na mangga, lima ang laki",
        "Sweet and juicy, grown in Guimaras",
    ],
)
def test_ordinary_text_is_not_contact_info(text):
    result = _check(name="Mangga", description=text)
    assert not any(i.code == lc.CONTACT_INFO_DETECTED for i in result.hard_blocks)


@pytest.mark.parametrize(
    "text", ["GCash me for payment", "Bank transfer only", "kaliwaan sa bayan"]
)
def test_off_platform_payment_is_a_hard_block(text):
    result = _check(name="Talong", description=text)
    assert ("description", lc.OFF_PLATFORM_PAYMENT) in _codes(result.hard_blocks)


def test_a_payment_name_alone_is_a_soft_flag():
    result = _check(name="Talong", description="We also use GCash at home")
    assert result.valid
    assert ("description", lc.PAYMENT_MENTION) in _codes(result.soft_flags)


def test_spaced_out_letters_are_found():
    result = _check(name="Talong", description="add me on v i b e r")
    assert ("description", lc.CONTACT_INFO_DETECTED) in _codes(result.hard_blocks)


# --- the word table --------------------------------------------------------

TERMS = [
    lc.Term("zorbleck", lc.CATEGORY_PROFANITY, lc.HARD_BLOCK),
    lc.Term("fresh pork", lc.CATEGORY_PROHIBITED, lc.HARD_BLOCK),
    lc.Term("itlog", lc.CATEGORY_PROHIBITED, lc.HARD_BLOCK),
    lc.Term("best deal", lc.CATEGORY_SPAM, lc.SOFT_FLAG),
]


def test_prohibited_item_is_a_hard_block_and_named():
    result = _check(name="Itlog ng pato", terms=TERMS)
    block = next(i for i in result.hard_blocks if i.code == lc.PROHIBITED_ITEM)
    assert block.field == "name"
    assert "'itlog'" in block.message


def test_bad_language_is_blocked_without_repeating_the_word():
    result = _check(name="Talong", description="what a Z0RBL3CK price", terms=TERMS)
    block = next(i for i in result.hard_blocks if i.code == lc.BAD_LANGUAGE)
    assert "zorbleck" not in block.message.lower()


def test_terms_match_whole_words_only():
    result = _check(name="Talong", description="itlogan farm road", terms=TERMS)
    assert result.valid


def test_soft_terms_flag_without_blocking():
    result = _check(name="Talong", description="The best deal in town", terms=TERMS)
    assert result.valid
    assert ("description", lc.FLAGGED_TERM) in _codes(result.soft_flags)
    assert result.recommended_status == ProduceStatus.UNDER_REVIEW


# --- spam --------------------------------------------------------------------


def test_keyword_spam_is_flagged():
    assert ("name", lc.KEYWORD_REPETITION) in _codes(
        _check(name="mango mango mango sweet").soft_flags
    )
    assert ("name", lc.ALL_CAPS) in _codes(
        _check(name="FRESH SWEET CARABAO MANGO").soft_flags
    )
    assert ("description", lc.EMOJI_OVERLOAD) in _codes(
        _check(name="Mangga", description="🥭🥭🥭🥭🥭 sweet").soft_flags
    )
    long_list = "mango, mangga, carabao, sweet, ripe, fresh, juicy, big, cheap, best"
    assert ("description", lc.COMMA_LIST) in _codes(
        _check(name="Mangga", description=long_list).soft_flags
    )


def test_a_normal_description_is_not_spam():
    text = (
        "Ang mga mangga namin ay galing sa Guimaras. Ang mga puno ay alaga sa "
        "organikong pataba, at ang ani ay pinipili isa-isa. Mango season is "
        "short, so order early."
    )
    result = _check(name="Carabao Mango", description=text, category="Fruits")
    assert result.soft_flags == []
    assert result.recommended_status == ProduceStatus.LIVE


# --- produce match -----------------------------------------------------------


def test_category_mismatch_suggests_the_right_category():
    result = _check(name="Carabao Mango", category="Vegetables")
    flag = next(i for i in result.soft_flags if i.code == lc.CATEGORY_MISMATCH)
    assert flag.suggestion == "Fruits"
    assert _check(name="Talong", category="Fruits").soft_flags[0].suggestion == (
        "Vegetables"
    )
    assert _check(name="Talong", category="Vegetables").soft_flags == []


def _ref(commodity, aliases="", source="DA Bantay Presyo"):
    return ReferencePrice(
        commodity=commodity,
        aliases=aliases,
        unit="kg",
        low=10,
        high=20,
        source=source,
        as_of=TODAY,
    )


def test_unknown_produce_is_flagged_only_with_real_reference_data():
    rows = [_ref("Talong", "eggplant")]
    known = _check(name="Fresh eggplant", reference_rows=rows, reference_is_real=True)
    assert known.soft_flags == []
    unknown = _check(name="Dragon fruit", reference_rows=rows, reference_is_real=True)
    assert ("name", lc.UNKNOWN_COMMODITY) in _codes(unknown.soft_flags)
    sample = _check(name="Dragon fruit", reference_rows=rows, reference_is_real=False)
    assert sample.soft_flags == []


# --- dates, tiers, duplicates -------------------------------------------------


def test_date_rules():
    future = _check(harvest_date=TODAY + timedelta(days=1))
    assert ("harvest_date", lc.FUTURE_HARVEST_DATE) in _codes(future.hard_blocks)
    inverted = _check(harvest_date=TODAY, best_before=TODAY - timedelta(days=2))
    assert ("best_before", lc.BEST_BEFORE_BEFORE_HARVEST) in _codes(
        inverted.hard_blocks
    )
    required = lc.run_checks(lc.ListingInput(), today=TODAY, require_dates=True)
    assert ("harvest_date", lc.DATES_REQUIRED) in _codes(required.hard_blocks)


def test_shelf_life_depends_on_the_produce():
    harvest = TODAY - timedelta(days=1)
    lettuce = _check(
        name="Lettuce", harvest_date=harvest, best_before=harvest + timedelta(60)
    )
    assert ("best_before", lc.EXCESSIVE_SHELF_LIFE) in _codes(lettuce.soft_flags)
    onion = _check(
        name="Red onion", harvest_date=harvest, best_before=harvest + timedelta(60)
    )
    assert onion.soft_flags == []
    mango = _check(
        name="Mangga", harvest_date=harvest, best_before=harvest + timedelta(45)
    )
    assert ("best_before", lc.EXCESSIVE_SHELF_LIFE) in _codes(mango.soft_flags)


def test_a_larger_quantity_cannot_cost_more_per_unit():
    result = _check(
        name="Talong",
        price=100,
        min_order_qty=1,
        price_tiers=(PriceTier(min_qty=10, unit_price=120),),
    )
    assert ("price_tiers", lc.INVALID_PRICE_TIER) in _codes(result.hard_blocks)


def test_duplicate_listing_same_name_and_unit():
    others = [("TALONG ", "kg"), ("Ampalaya", "kg")]
    dup = _check(name="talong", unit="kg", other_listings=others)
    assert ("name", lc.DUPLICATE_LISTING) in _codes(dup.hard_blocks)
    other_unit = _check(name="talong", unit="lbs", other_listings=others)
    assert other_unit.valid


def test_field_errors_join_messages_per_field():
    result = _check(name="PM me 09171234567", description="GCash me")
    errors = result.field_errors()
    assert set(errors) == {"name", "description"}
    assert "phone number" in errors["name"]
    assert "social media" in errors["name"]

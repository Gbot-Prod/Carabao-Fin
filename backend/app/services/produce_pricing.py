"""Minimum order quantity and bulk price tiers on produce listings.

Quantities count the listing's sale unit (``unit_quantity`` of ``unit``), the
same number a buyer puts in their cart. A tier sets the unit price once a line
reaches its ``min_qty``; the highest tier reached prices the whole line, and the
base ``price`` applies below the first tier. Prices are whole pesos.
"""

from typing import Any

from pydantic import TypeAdapter

from app.models.produce import Produce
from app.schemas.produce import PriceTier

_tiers_adapter = TypeAdapter(list[PriceTier])


def parse_tiers(raw: list[Any] | None) -> list[PriceTier]:
    """Stored tiers (JSON dicts) as models, lowest ``min_qty`` first."""
    return sorted(_tiers_adapter.validate_python(raw or []), key=lambda t: t.min_qty)


def pricing_error(price: int, min_order_qty: int, tiers: list[PriceTier]) -> str | None:
    """Why a listing's minimum order and tiers are invalid, or None."""
    ordered = sorted(tiers, key=lambda t: t.min_qty)
    if len({t.min_qty for t in ordered}) != len(ordered):
        return "Each price tier needs a different quantity"
    if ordered and ordered[0].min_qty <= min_order_qty:
        return "Price tiers must start above the minimum order quantity"
    previous_price = price
    for tier in ordered:
        if tier.unit_price >= previous_price:
            return "Each price tier must be cheaper than the price before it"
        previous_price = tier.unit_price
    return None


def serialize_tiers(tiers: list[PriceTier]) -> list[dict[str, int]]:
    """Tiers as stored on the listing, lowest ``min_qty`` first."""
    return [t.model_dump() for t in sorted(tiers, key=lambda t: t.min_qty)]


def unit_price_for(produce: Produce, quantity: int) -> int:
    """The unit price a line of ``quantity`` pays on this listing."""
    unit_price: int = produce.price
    for tier in parse_tiers(produce.price_tiers):
        if quantity >= tier.min_qty:
            unit_price = tier.unit_price
    return unit_price

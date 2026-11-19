"""Holiday mode for a farm (CF-0066, B13).

A paused farm keeps its page, listings and reviews, so buyers can still find
it, but checkout, the cart and reorder treat it as not taking orders.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from app.services.produce_freshness import ph_today

# Long enough for a harvest gap; longer breaks should hide the listings.
MAX_PAUSE_DAYS = 90


def paused_until(merchant: Any, today: date | None = None) -> date | None:
    """The last paused day, or None when the farm takes orders today."""
    until = getattr(merchant, "paused_until", None)
    if until is None:
        return None
    return until if (today or ph_today()) <= until else None


def is_paused(merchant: Any, today: date | None = None) -> bool:
    return paused_until(merchant, today) is not None


def pause_detail(merchant: Any) -> str:
    """The buyer-facing reason checkout refuses a paused farm's items."""
    until = paused_until(merchant)
    name = getattr(merchant, "merchant_name", None) or "This farm"
    when = until.strftime("%b %d").replace(" 0", " ") if until else "later"
    return (
        f"{name} is on a break and takes orders again after {when}. "
        "Remove their items from your cart to continue."
    )


def latest_allowed(today: date | None = None) -> date:
    return (today or ph_today()) + timedelta(days=MAX_PAUSE_DAYS)

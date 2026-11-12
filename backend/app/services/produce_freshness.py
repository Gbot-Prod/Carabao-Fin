"""Harvest and best-before dates on produce listings.

A listing whose best-before date has passed is expired: buyers no longer see it
and it cannot be ordered, but its farmer still sees it so they can update or
delete it. Listings created before these dates existed have NULL dates and stay
listed. Dates are calendar days in Philippine time.
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import ColumnElement, and_, or_

from app.models.produce import Produce

PH_TZ = timezone(timedelta(hours=8))


def ph_today() -> date:
    return datetime.now(PH_TZ).date()


def is_listed(today: date) -> ColumnElement[bool]:
    """SQL filter for produce buyers may see and order on ``today``.

    Leaves out expired listings and listings an admin has hidden (A6).
    """
    return and_(
        Produce.hidden_at.is_(None),
        or_(Produce.best_before.is_(None), Produce.best_before >= today),
    )


def is_expired(produce: Produce, today: date) -> bool:
    return produce.best_before is not None and produce.best_before < today


def freshness_error(harvest_date: date | None, best_before: date | None) -> str | None:
    """Why a listing's dates are invalid, or None when they are fine."""
    if harvest_date is None or best_before is None:
        return "Harvest date and best-before date are required"
    if harvest_date > ph_today():
        return "Harvest date cannot be in the future"
    if best_before < harvest_date:
        return "Best-before date cannot be earlier than the harvest date"
    return None

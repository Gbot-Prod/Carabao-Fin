"""Log changes to the pin or the area of an address (pin quality, item 3).

Saved addresses (create, PATCH, delete) and the shop location
(PATCH /merchants/me) add one ``address_change_logs`` row when the pin or
the city/barangay changes. Edits to other fields (label, recipient, street
text) add no row.

A row holds the PSGC codes before and after and how far the pin moved, never
coordinates or address text (CF-0059). ``record`` only adds the row; the
caller's commit saves it with the change. ``purge_old`` runs in the main.py
cleanup loop.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple

from sqlalchemy import ColumnElement
from sqlalchemy.orm import Session

from app.models.address_change_log import AddressChangeLog
from app.services.pinned_location import Coords, distance_m, stored

KEEP_DAYS = 180
# A pin that moved less than this is the same pin (float noise, re-saves).
SAME_PIN_M = 1.0


class Snapshot(NamedTuple):
    pin: Coords | None
    city_code: str | None
    barangay_code: str | None


def snapshot(obj: Any) -> Snapshot:
    return Snapshot(
        pin=stored(obj.lat, obj.lng),
        city_code=obj.city_code,
        barangay_code=obj.barangay_code,
    )


def _pin_change(
    old: Coords | None, new: Coords | None
) -> tuple[str | None, float | None]:
    if old is None and new is None:
        return None, None
    if old is None:
        return "set", None
    if new is None:
        return "cleared", None
    moved = distance_m(old, new)
    if moved < SAME_PIN_M:
        return None, None
    return "moved", round(moved, 1)


def record(
    db: Session,
    *,
    user_id: int,
    target_type: str,
    target_id: int,
    action: str,
    before: Snapshot | None,
    after: Snapshot | None,
) -> AddressChangeLog | None:
    """Add a row when the pin or the area changed; return it, or None."""
    empty = Snapshot(None, None, None)
    old, new = before or empty, after or empty
    pin_change, moved = _pin_change(old.pin, new.pin)
    area_changed = (old.city_code, old.barangay_code) != (
        new.city_code,
        new.barangay_code,
    )
    if action == "update" and pin_change is None and not area_changed:
        return None
    entry = AddressChangeLog(
        user_id=user_id,
        target_type=target_type,
        target_id=target_id,
        action=action,
        old_city_code=old.city_code,
        new_city_code=new.city_code,
        old_barangay_code=old.barangay_code,
        new_barangay_code=new.barangay_code,
        pin_change=pin_change,
        pin_moved_m=moved,
    )
    db.add(entry)
    return entry


def purge_old(db: Session, now: datetime | None = None) -> int:
    """Delete rows older than KEEP_DAYS; the caller commits."""
    cutoff = (now or datetime.now(UTC)) - timedelta(days=KEEP_DAYS)
    # The model uses untyped Column(), so `column < x` types as bool.
    created_at: Any = AddressChangeLog.created_at
    old: ColumnElement[bool] = created_at < cutoff
    return db.query(AddressChangeLog).filter(old).delete(synchronize_session=False)

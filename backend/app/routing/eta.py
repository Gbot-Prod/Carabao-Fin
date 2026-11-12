from __future__ import annotations

import math
from datetime import UTC, datetime


def _eta_from_waypoints(
    shipped_at: datetime | None, route_waypoints: list[dict], order_id: int
) -> tuple[float, int | None]:
    """Estimated progress and minutes to arrival, from the stored route schedule.

    Progress is estimated from the route's planned durations; there is no live
    vehicle location. When the route has no arrival estimate for this order,
    returns ``(0.0, None)`` rather than inventing one.
    """
    now = datetime.now(UTC)
    stop = next(
        (
            w
            for w in route_waypoints
            if w.get("order_id") == order_id and w.get("estimated_arrival_at")
        ),
        None,
    )
    if not stop:
        return 0.0, None

    arrival = datetime.fromisoformat(stop["estimated_arrival_at"])
    if arrival.tzinfo is None:
        arrival = arrival.replace(tzinfo=UTC)
    eta_secs = (arrival - now).total_seconds()
    eta_minutes = max(0, math.ceil(eta_secs / 60))
    pickup = next((w for w in route_waypoints if w.get("type") == "pickup"), {})
    total_dur = float(
        pickup.get("total_duration_seconds") or stop.get("duration_seconds") or 0
    )
    if shipped_at and total_dur > 0:
        tz_shipped = shipped_at if shipped_at.tzinfo else shipped_at.replace(tzinfo=UTC)
        elapsed = (now - tz_shipped).total_seconds()
        progress = min(1.0, max(0.0, round(elapsed / total_dur, 4)))
    elif total_dur > 0:
        elapsed = max(0.0, total_dur - max(0.0, eta_secs))
        progress = min(1.0, max(0.0, round(elapsed / total_dur, 4)))
    else:
        progress = 0.0 if eta_secs > 0 else 1.0
    return progress, eta_minutes

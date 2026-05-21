from __future__ import annotations

import math
import time
from datetime import datetime, timezone

_CYCLE_SECONDS = 120


def _eta_from_waypoints(shipped_at: datetime | None, route_waypoints: list[dict], order_id: int) -> tuple[float, int]:
    now = datetime.now(timezone.utc)
    stop = next((w for w in route_waypoints if w.get("order_id") == order_id and w.get("estimated_arrival_at")), None)
    if stop and shipped_at:
        tz_shipped = shipped_at if shipped_at.tzinfo else shipped_at.replace(tzinfo=timezone.utc)
        arrival = datetime.fromisoformat(stop["estimated_arrival_at"])
        eta_secs = (arrival - now).total_seconds()
        eta_minutes = max(0, math.ceil(eta_secs / 60))
        pickup = next((w for w in route_waypoints if w.get("type") == "pickup"), {})
        total_dur = float(pickup.get("total_duration_seconds") or 0)
        if total_dur > 0:
            elapsed = (now - tz_shipped).total_seconds()
            progress = min(1.0, max(0.0, round(elapsed / total_dur, 4)))
        else:
            progress = 0.0 if eta_secs > 0 else 1.0
        return progress, eta_minutes
    elapsed = time.time() % _CYCLE_SECONDS
    progress = round(elapsed / _CYCLE_SECONDS, 4)
    return progress, math.ceil((1.0 - progress) * _CYCLE_SECONDS / 60)

from __future__ import annotations

import math
from copy import deepcopy
from dataclasses import dataclass, field


@dataclass
class Stop:
    order_id: int
    merchant_id: int
    lat: float
    lng: float


@dataclass
class RouteState:
    """
    Represents a single delivery route as an ordered list of stops.
    The depot (rider start point) is the first and last position.
    """
    depot_lat: float
    depot_lng: float
    stops: list[Stop] = field(default_factory=list)
    # Stops not yet assigned to the route (destroyed but not repaired)
    unassigned: list[Stop] = field(default_factory=list)

    def objective(self) -> float:
        """Total Euclidean distance of the route (depot → stops → depot)."""
        if not self.stops:
            # Heavily penalise any unassigned stops so the solver is pushed
            # to assign everything.
            return float("inf") if self.unassigned else 0.0

        route = [self._depot()] + self.stops + [self._depot()]
        total = sum(
            _distance(route[i], route[i + 1]) for i in range(len(route) - 1)
        )
        # Penalise unassigned stops so they get reinserted.
        total += len(self.unassigned) * 1_000_000
        return total

    def copy(self) -> RouteState:
        return deepcopy(self)

    # ------------------------------------------------------------------
    def _depot(self) -> Stop:
        return Stop(order_id=-1, merchant_id=-1, lat=self.depot_lat, lng=self.depot_lng)


def _distance(a: Stop, b: Stop) -> float:
    return math.hypot(a.lat - b.lat, a.lng - b.lng)

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
        """Total Haversine distance of the route (depot → stops → depot).
        
        Uses Haversine formula for accurate lat/lng distances on Earth.
        Penalises unassigned stops to force the repair operator to reinsert them.
        """
        if not self.stops:
            # Heavily penalise any unassigned stops so the solver is pushed
            # to assign everything.
            return float("inf") if self.unassigned else 0.0

        route = [self._depot()] + self.stops + [self._depot()]
        total = sum(
            _haversine_distance(route[i], route[i + 1]) for i in range(len(route) - 1)
        )
        # Penalise unassigned stops so they get reinserted.
        total += len(self.unassigned) * 1_000_000
        return total

    def copy(self) -> RouteState:
        return deepcopy(self)

    # ------------------------------------------------------------------
    def _depot(self) -> Stop:
        return Stop(order_id=-1, merchant_id=-1, lat=self.depot_lat, lng=self.depot_lng)


def _haversine_distance(a: Stop, b: Stop) -> float:
    """
    Calculate great-circle distance between two points in km using Haversine formula.
    
    Much more accurate than Euclidean for lat/lng coordinates.
    Philippines is roughly 2000 km north-south, so results are in realistic km range.
    """
    R_EARTH_KM = 6371  # Earth radius in km
    
    lat_a, lng_a = math.radians(a.lat), math.radians(a.lng)
    lat_b, lng_b = math.radians(b.lat), math.radians(b.lng)
    
    dlat = lat_b - lat_a
    dlng = lng_b - lng_a
    
    sin_dlat = math.sin(dlat / 2)
    sin_dlng = math.sin(dlng / 2)
    
    a_coeff = sin_dlat * sin_dlat + math.cos(lat_a) * math.cos(lat_b) * sin_dlng * sin_dlng
    c = 2 * math.atan2(math.sqrt(a_coeff), math.sqrt(1 - a_coeff))
    
    return R_EARTH_KM * c

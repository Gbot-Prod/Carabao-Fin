from __future__ import annotations

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
    The depot is the rider's start point.
    """

    depot_lat: float
    depot_lng: float
    stops: list[Stop] = field(default_factory=list)

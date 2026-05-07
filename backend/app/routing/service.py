"""
Thin service layer between the tracking API and the ALNS solver.
Responsible for converting geocoded coordinates into Stop objects,
running the solver, and returning the ordered stop list.
"""

from app.routing.state import RouteState, Stop
from app.routing.solver import solve


def compute_route(
    stops: list[Stop],
    depot_lat: float,
    depot_lng: float,
) -> list[Stop]:
    """
    Return stops in ALNS-optimised visit order.
    Single-stop routes are returned as-is (no solver overhead needed).
    """
    if not stops:
        return []
    if len(stops) == 1:
        return stops
    return solve(stops, depot_lat, depot_lng).stops

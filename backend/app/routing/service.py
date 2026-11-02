"""
Thin service layer between the tracking API and the ALNS solver.
Responsible for converting geocoded coordinates into Stop objects,
running the solver, and returning the ordered stop list.
"""

from app.routing.solver import solve
from app.routing.state import Stop


def compute_route(
    stops: list[Stop],
    depot_lat: float,
    depot_lng: float,
    return_to_depot: bool = False,
    distance_matrix: list[list[float]] | None = None,
) -> list[Stop]:
    """
    Return stops in ALNS-optimised visit order.
    Single-stop routes are returned as-is (no solver overhead needed).

    Defaults to an open path (one pickup, then deliveries, ending at the last
    stop), which is how shipments run. Pass return_to_depot=True to optimise
    a round trip back to the merchant instead.

    distance_matrix: optional road travel-time/distance matrix (depot at
    index 0, stops[i] at i + 1); straight-line distance is used without it.
    """
    if not stops:
        return []
    if len(stops) == 1:
        return stops
    return solve(
        stops,
        depot_lat,
        depot_lng,
        return_to_depot=return_to_depot,
        distance_matrix=distance_matrix,
    ).stops

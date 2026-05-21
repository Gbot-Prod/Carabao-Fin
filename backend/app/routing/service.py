"""
Thin service layer between the tracking API and the ALNS solver.
Responsible for converting geocoded coordinates into Stop objects,
running the solver, and returning the ordered stop list.
"""

from app.routing.state import RouteState, Stop
from app.routing.solver import solve, solve_multi


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


def compute_routes(
    stops: list[Stop],
    depot_lat: float,
    depot_lng: float,
    n_vehicles: int,
) -> list[list[Stop]]:
    """
    Return n_vehicles ordered stop lists (one per rider).
    Falls back to compute_route when n_vehicles == 1.
    """
    if n_vehicles <= 1:
        return [compute_route(stops, depot_lat, depot_lng)]
    if not stops:
        return [[] for _ in range(n_vehicles)]
    if len(stops) <= n_vehicles:
        # One stop per vehicle; remaining vehicles get empty routes.
        return [[s] for s in stops] + [[] for _ in range(n_vehicles - len(stops))]
    result = solve_multi(stops, depot_lat, depot_lng, n_vehicles)
    return [r.stops for r in result.routes]

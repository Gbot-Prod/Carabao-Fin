"""
Repair operators — each takes (state, rng) and returns a NEW state with
all stops from `unassigned` reinserted into `stops`. Never mutate the original.
"""

import numpy as np
from app.routing.state import RouteState, Stop, _haversine_distance


def greedy_insert(state: RouteState, rng: np.random.Generator) -> RouteState:
    """
    For each unassigned stop, find the cheapest feasible insertion position
    and insert it there.
    """
    result = state.copy()

    # Shuffle so repeated calls with the same state don't always insert in
    # the same order (adds diversity without sacrificing greedy logic).
    rng.shuffle(result.unassigned)

    while result.unassigned:
        stop = result.unassigned.pop(0)
        best_pos, best_cost = _best_insertion(result.stops, stop, result._depot())
        result.stops.insert(best_pos, stop)

    return result


def random_insert(state: RouteState, rng: np.random.Generator) -> RouteState:
    """
    Insert each unassigned stop at a random position. Useful as a diversification
    operator when greedy_insert gets stuck in local optima.
    """
    result = state.copy()
    rng.shuffle(result.unassigned)

    while result.unassigned:
        stop = result.unassigned.pop(0)
        pos = int(rng.integers(0, len(result.stops) + 1))
        result.stops.insert(pos, stop)

    return result


# ---------------------------------------------------------------------------

def _best_insertion(stops: list[Stop], candidate: Stop, depot: Stop) -> tuple[int, float]:
    """Return (position, delta_cost) for the cheapest insertion of candidate.
    
    Uses Haversine distance for realistic lat/lng calculations.
    """
    route = [depot] + stops + [depot]
    best_pos = 1
    best_delta = float("inf")

    for i in range(1, len(route)):
        prev, nxt = route[i - 1], route[i]
        delta = (
            _haversine_distance(prev, candidate)
            + _haversine_distance(candidate, nxt)
            - _haversine_distance(prev, nxt)
        )
        if delta < best_delta:
            best_delta = delta
            best_pos = i - 1  # index into `stops` list, not route list

    return best_pos, best_delta

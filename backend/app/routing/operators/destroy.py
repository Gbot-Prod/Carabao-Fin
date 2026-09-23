"""
Destroy operators — each takes (state, rng) and returns a NEW state with
some stops moved from `stops` into `unassigned`. Never mutate the original.
"""

import heapq
import math
import numpy as np
from app.routing.state import RouteState, Stop, MultiRouteState, _haversine_distance


def random_removal(state: RouteState, rng: np.random.Generator) -> RouteState:
    """Remove a random subset of stops (10–30% of the route)."""
    result = state.copy()

    if not result.stops:
        return result

    n = max(1, int(len(result.stops) * rng.uniform(0.1, 0.3)))
    indices = rng.choice(len(result.stops), size=n, replace=False)
    indices_set = set(indices)

    removed = [s for i, s in enumerate(result.stops) if i in indices_set]
    result.stops = [s for i, s in enumerate(result.stops) if i not in indices_set]
    result.unassigned.extend(removed)

    return result


def worst_removal(state: RouteState, rng: np.random.Generator) -> RouteState:
    """
    Remove the stops that contribute the most distance to the route.
    Removes 10–30% of stops, choosing the worst-cost ones with some
    randomisation (Shaw-style noise factor).
    """
    result = state.copy()

    if not result.stops:
        return result

    n = max(1, int(len(result.stops) * rng.uniform(0.1, 0.3)))

    # Compute removal costs once (O(N)) instead of recomputing after each removal.
    # This reduces the operator from ~O(N^3) to ~O(N log N) for large N.
    route = [result._depot()] + result.stops + [result._depot()]
    costs: list[float] = []
    for i in range(1, len(route) - 1):
        prev_stop = route[i - 1]
        curr_stop = route[i]
        next_stop = route[i + 1]
        before = _haversine_distance(prev_stop, curr_stop) + _haversine_distance(
            curr_stop, next_stop
        )
        after = _haversine_distance(prev_stop, next_stop)
        costs.append(before - after)

    noise = rng.uniform(0.9, 1.1, size=len(costs))
    noisy_costs = [c * w for c, w in zip(costs, noise)]

    n = min(n, len(result.stops))
    remove_indices = sorted(np.argsort(noisy_costs)[-n:].tolist(), reverse=True)
    for idx in remove_indices:
        result.unassigned.append(result.stops.pop(int(idx)))

    return result


def knearest_removal(state: RouteState, rng: np.random.Generator) -> RouteState:
    """
    Remove a geographic cluster of stops around a random pivot.

    Picks a random stop as the pivot, then removes the k closest stops to it
    (including the pivot itself). Complements random_removal (scattered) and
    worst_removal (cost-based) with a spatial approach — useful for delivery
    areas where stops cluster by neighbourhood.
    """
    result = state.copy()

    if not result.stops:
        return result

    n = max(1, int(len(result.stops) * rng.uniform(0.1, 0.3)))
    pivot = result.stops[int(rng.integers(len(result.stops)))]

    distances = [(i, _haversine_distance(pivot, s)) for i, s in enumerate(result.stops)]
    nearest_n = heapq.nsmallest(n, distances, key=lambda x: x[1])
    remove_indices = sorted([d[0] for d in nearest_n], reverse=True)
    for idx in remove_indices:
        result.unassigned.append(result.stops.pop(idx))

    return result


# ---------------------------------------------------------------------------
# Multi-vehicle destroy operators
# ---------------------------------------------------------------------------

def cross_route_removal(state: MultiRouteState, rng: np.random.Generator) -> MultiRouteState:
    """
    Remove 10–30% of all stops drawn uniformly across every route,
    placing them in the shared unassigned pool.
    """
    result = state.copy()

    all_stops = [(ri, si) for ri, r in enumerate(result.routes) for si in range(len(r.stops))]
    if not all_stops:
        return result

    n = max(1, int(len(all_stops) * rng.uniform(0.1, 0.3)))
    n = min(n, len(all_stops))

    chosen = rng.choice(len(all_stops), size=n, replace=False)
    # Build per-route sets of indices to remove, then remove highest-index first.
    per_route: dict[int, set[int]] = {}
    for c in chosen:
        ri, si = all_stops[c]
        per_route.setdefault(ri, set()).add(si)

    for ri, indices in per_route.items():
        for si in sorted(indices, reverse=True):
            result.unassigned.append(result.routes[ri].stops.pop(si))

    return result


def random_removal_multi(state: MultiRouteState, rng: np.random.Generator) -> MultiRouteState:
    """Apply random_removal independently to each route, pooling unassigned stops."""
    result = state.copy()
    for route in result.routes:
        if not route.stops:
            continue
        n = max(1, int(len(route.stops) * rng.uniform(0.1, 0.3)))
        indices = set(rng.choice(len(route.stops), size=n, replace=False).tolist())
        removed = [s for i, s in enumerate(route.stops) if i in indices]
        route.stops = [s for i, s in enumerate(route.stops) if i not in indices]
        result.unassigned.extend(removed)
    return result

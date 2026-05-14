"""
Destroy operators — each takes (state, rng) and returns a NEW state with
some stops moved from `stops` into `unassigned`. Never mutate the original.
"""

import math
import numpy as np
from app.routing.state import RouteState, Stop, _haversine_distance


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

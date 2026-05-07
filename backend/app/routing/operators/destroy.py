"""
Destroy operators — each takes (state, rng) and returns a NEW state with
some stops moved from `stops` into `unassigned`. Never mutate the original.
"""

import math
import numpy as np
from app.routing.state import RouteState, Stop, _distance


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

    def removal_cost(idx: int) -> float:
        route = [result._depot()] + result.stops + [result._depot()]
        prev_stop = route[idx]
        curr_stop = route[idx + 1]
        next_stop = route[idx + 2]
        before = _distance(prev_stop, curr_stop) + _distance(curr_stop, next_stop)
        after = _distance(prev_stop, next_stop)
        return before - after

    for _ in range(n):
        if not result.stops:
            break
        costs = [removal_cost(i) for i in range(len(result.stops))]
        # Randomise selection slightly so the operator isn't fully deterministic.
        noise = rng.uniform(0.9, 1.1, size=len(costs))
        noisy_costs = [c * w for c, w in zip(costs, noise)]
        worst_idx = int(np.argmax(noisy_costs))
        result.unassigned.append(result.stops.pop(worst_idx))

    return result

"""
Repair operators — each takes (state, rng) and returns a NEW state with
all stops from `unassigned` reinserted into `stops`. Never mutate the original.
"""

import heapq

import numpy as np
from app.routing.state import RouteState, Stop, MultiRouteState, _haversine_distance


def greedy_insert(state: RouteState, rng: np.random.Generator) -> RouteState:
    """
    For each unassigned stop, find the cheapest feasible insertion position
    and insert it there.
    """
    result = state.copy()
    rng.shuffle(result.unassigned)

    while result.unassigned:
        stop = result.unassigned.pop(0)
        best_pos, _ = _best_insertion(result.stops, stop, result._depot())
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


def regret2_insert(state: RouteState, rng: np.random.Generator) -> RouteState:
    """
    Regret-2 insertion: always insert the stop with the highest regret first.

    Regret = (second-best insertion cost) - (best insertion cost).
    Stops with large regret would be badly placed if deferred, so they get
    priority over easy-to-place stops.
    """
    result = state.copy()

    while result.unassigned:
        best_stop_idx = 0
        best_pos = 0
        best_regret = -float("inf")

        depot = result._depot()
        for si, stop in enumerate(result.unassigned):
            costs = _all_insertion_costs(result.stops, stop, depot)
            top2 = heapq.nsmallest(2, costs)
            c1 = top2[0][0]
            c2 = top2[1][0] if len(top2) > 1 else c1
            regret = c2 - c1
            if regret > best_regret:
                best_regret = regret
                best_pos = costs[0][1]
                best_stop_idx = si

        stop = result.unassigned.pop(best_stop_idx)
        result.stops.insert(best_pos, stop)

    return result


# ---------------------------------------------------------------------------
# Multi-vehicle repair operators
# ---------------------------------------------------------------------------

def cross_route_insert(state: MultiRouteState, rng: np.random.Generator) -> MultiRouteState:
    """
    Stop-driven global greedy: for each unassigned stop find the cheapest
    (route, position) pair across all routes and insert it there.
    """
    result = state.copy()
    rng.shuffle(result.unassigned)

    while result.unassigned:
        stop = result.unassigned.pop(0)
        best_route = 0
        best_pos = 0
        best_cost = float("inf")

        for ri, route in enumerate(result.routes):
            pos, cost = _best_insertion(route.stops, stop, route._depot())
            if cost < best_cost:
                best_cost = cost
                best_route = ri
                best_pos = pos

        result.routes[best_route].stops.insert(best_pos, stop)

    return result


def greedy_insert_multi(state: MultiRouteState, rng: np.random.Generator) -> MultiRouteState:
    """
    Route-driven greedy: each route pulls the cheapest available stop from
    the shared pool into itself, round-robin until the pool is empty.

    Distinct from cross_route_insert (stop-driven) — here routes compete for
    stops rather than stops being assigned to the best route.
    """
    result = state.copy()
    rng.shuffle(result.unassigned)

    while result.unassigned:
        for route in result.routes:
            if not result.unassigned:
                break
            depot = route._depot()
            best_stop_idx = 0
            best_pos = 0
            best_cost = float("inf")

            for si, stop in enumerate(result.unassigned):
                pos, cost = _best_insertion(route.stops, stop, depot)
                if cost < best_cost:
                    best_cost = cost
                    best_pos = pos
                    best_stop_idx = si

            stop = result.unassigned.pop(best_stop_idx)
            route.stops.insert(best_pos, stop)

    return result


# ---------------------------------------------------------------------------

def _best_insertion(stops: list[Stop], candidate: Stop, depot: Stop) -> tuple[int, float]:
    """Return (position, delta_cost) for the cheapest insertion of candidate."""
    cost, pos = min(_all_insertion_costs(stops, candidate, depot), key=lambda x: x[0])
    return pos, cost


def _all_insertion_costs(stops: list[Stop], candidate: Stop, depot: Stop) -> list[tuple[float, int]]:
    """Return [(delta_cost, position), ...] for every possible insertion slot."""
    route = [depot] + stops + [depot]
    results: list[tuple[float, int]] = []
    for i in range(1, len(route)):
        prev, nxt = route[i - 1], route[i]
        delta = (
            _haversine_distance(prev, candidate)
            + _haversine_distance(candidate, nxt)
            - _haversine_distance(prev, nxt)
        )
        results.append((delta, i - 1))
    return results

import math
from typing import Any

import numpy as np

from app.routing.state import RouteState, Stop, _haversine_distance
from app.routing.operators.destroy import (
    random_removal,
    worst_removal,
    knearest_removal,
)
from app.routing.operators.repair import (
    greedy_insert,
    random_insert,
    regret2_insert,
)

_DESTROY_OPS = [random_removal, worst_removal, knearest_removal]
_REPAIR_OPS  = [greedy_insert, random_insert, regret2_insert]

_SCORE_BEST    = 10.0
_SCORE_IMPROVE =  5.0
_SCORE_ACCEPT  =  2.0
_SCORE_REJECT  =  0.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _roulette_select(weights: list[float], rng: np.random.Generator) -> int:
    """Return an index sampled proportionally to weights."""
    total = sum(weights)
    pick = rng.random() * total
    cumulative = 0.0
    for i, w in enumerate(weights):
        cumulative += w
        if pick <= cumulative:
            return i
    return len(weights) - 1


def _update_weight(weights: list[float], idx: int, score: float, reaction: float) -> None:
    weights[idx] = (1.0 - reaction) * weights[idx] + reaction * score


def _compute_temp_schedule(avg_leg_km: float, max_iterations: int) -> tuple[float, float]:
    start_temp = max(0.5, avg_leg_km)
    end_temp = max(0.01, start_temp * 0.01)
    if max_iterations <= 1 or start_temp <= end_temp:
        step = 0.999
    else:
        step = float((end_temp / start_temp) ** (1.0 / (max_iterations - 1)))
        step = min(0.999999, max(0.90, step))
    return start_temp, step


def _run_sa_loop(
    current: Any,
    destroy_ops: list,
    repair_ops: list,
    rng: np.random.Generator,
    max_iterations: int,
    segment_size: int,
    reaction: float,
    start_temp: float,
    step: float,
) -> Any:
    current_obj = current.objective()
    best = current.copy()
    best_obj = current_obj
    temp = start_temp
    d_weights = [1.0] * len(destroy_ops)
    r_weights = [1.0] * len(repair_ops)

    for i in range(max_iterations):
        d_idx = _roulette_select(d_weights, rng)
        r_idx = _roulette_select(r_weights, rng)

        candidate = repair_ops[r_idx](destroy_ops[d_idx](current, rng), rng)
        candidate_obj = candidate.objective()

        delta = candidate_obj - current_obj
        accepted = delta < 0 or rng.random() < math.exp(-delta / temp)

        if accepted:
            current = candidate
            current_obj = candidate_obj

        if current_obj < best_obj:
            best = current.copy()
            best_obj = current_obj
            score = _SCORE_BEST
        elif accepted and delta < 0:
            score = _SCORE_IMPROVE
        elif accepted:
            score = _SCORE_ACCEPT
        else:
            score = _SCORE_REJECT

        _update_weight(d_weights, d_idx, score, reaction)
        _update_weight(r_weights, r_idx, score, reaction)

        if (i + 1) % segment_size == 0:
            d_weights = [1.0] * len(destroy_ops)
            r_weights = [1.0] * len(repair_ops)

        temp *= step

    return best


def _two_opt(stops: list[Stop], depot: Stop) -> list[Stop]:
    """
    2-opt local search: repeatedly reverse sub-sequences that shorten the route.
    Returns a new list; does not mutate the input.
    """
    if len(stops) < 3:
        return list(stops)

    route = [depot] + list(stops) + [depot]
    improved = True
    while improved:
        improved = False
        for i in range(1, len(route) - 2):
            d_i_prev = _haversine_distance(route[i - 1], route[i])
            for j in range(i + 1, len(route) - 1):
                d_before = d_i_prev + _haversine_distance(route[j], route[j + 1])
                d_after = (
                    _haversine_distance(route[i - 1], route[j])
                    + _haversine_distance(route[i], route[j + 1])
                )
                if d_after < d_before - 1e-10:
                    route[i : j + 1] = route[i : j + 1][::-1]
                    improved = True

    return route[1:-1]


def _nearest_neighbour_initial(
    stops: list[Stop],
    depot_lat: float,
    depot_lng: float,
) -> list[Stop]:
    if len(stops) <= 1:
        return list(stops)

    remaining = list(stops)
    ordered: list[Stop] = []
    current = Stop(order_id=-1, merchant_id=-1, lat=depot_lat, lng=depot_lng)

    while remaining:
        next_idx = int(np.argmin([_haversine_distance(current, s) for s in remaining]))
        nxt = remaining.pop(next_idx)
        ordered.append(nxt)
        current = nxt

    return ordered


# ---------------------------------------------------------------------------
# Single-vehicle solver
# ---------------------------------------------------------------------------

def solve(
    stops: list[Stop],
    depot_lat: float,
    depot_lng: float,
    seed: int | None = None,
    max_iterations: int = 1_000,
    segment_size: int = 100,
    reaction: float = 0.4,
) -> RouteState:
    """Run the custom ALNS loop and return the best RouteState found."""
    rng = np.random.default_rng(seed)

    current = RouteState(
        depot_lat=depot_lat,
        depot_lng=depot_lng,
        stops=_nearest_neighbour_initial(stops, depot_lat, depot_lng),
    )

    legs = max(2, len(current.stops) + 1)
    avg_leg_km = max(1e-6, current.objective() / legs)
    start_temp, step = _compute_temp_schedule(avg_leg_km, max_iterations)

    best = _run_sa_loop(current, _DESTROY_OPS, _REPAIR_OPS, rng, max_iterations, segment_size, reaction, start_temp, step)
    best.stops = _two_opt(best.stops, best._depot())
    return best


# ---------------------------------------------------------------------------
# Multi-vehicle solver
# ---------------------------------------------------------------------------

def solve_multi(
    stops: list[Stop],
    depot_lat: float,
    depot_lng: float,
    n_vehicles: int,
    seed: int | None = None,
    max_iterations: int = 1_000,
    segment_size: int = 100,
    reaction: float = 0.4,
) -> "MultiRouteState":  # noqa: F821
    """Run multi-vehicle ALNS and return the best MultiRouteState found."""
    from app.routing.state import MultiRouteState
    from app.routing.operators.destroy import cross_route_removal, random_removal_multi
    from app.routing.operators.repair import cross_route_insert, greedy_insert_multi

    multi_destroy = [cross_route_removal, random_removal_multi]
    multi_repair  = [cross_route_insert,  greedy_insert_multi]

    rng = np.random.default_rng(seed)

    ordered = _nearest_neighbour_initial(stops, depot_lat, depot_lng)
    vehicle_stops: list[list[Stop]] = [[] for _ in range(n_vehicles)]
    for j, stop in enumerate(ordered):
        vehicle_stops[j % n_vehicles].append(stop)

    current = MultiRouteState(
        routes=[
            RouteState(depot_lat=depot_lat, depot_lng=depot_lng, stops=vs)
            for vs in vehicle_stops
        ],
    )

    avg_route_obj = current.objective() / max(1, n_vehicles)
    legs = max(2, max(len(r.stops) for r in current.routes) + 1)
    avg_leg_km = max(1e-6, avg_route_obj / legs)
    start_temp, step = _compute_temp_schedule(avg_leg_km, max_iterations)

    best = _run_sa_loop(current, multi_destroy, multi_repair, rng, max_iterations, segment_size, reaction, start_temp, step)
    for route in best.routes:
        route.stops = _two_opt(route.stops, route._depot())
    return best

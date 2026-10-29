import math
from collections.abc import Callable
from typing import Any

import numpy as np

from app.routing.operators.repair import _best_insertion
from app.routing.state import RouteState, Stop, _haversine_distance
from app.routing.tsp import haversine_matrix, solve_tour

_SCORE_BEST = 10.0
_SCORE_IMPROVE = 5.0
_SCORE_ACCEPT = 2.0
_SCORE_REJECT = 0.0


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


def _update_weight(
    weights: list[float], idx: int, score: float, reaction: float
) -> None:
    weights[idx] = (1.0 - reaction) * weights[idx] + reaction * score


def _compute_temp_schedule(
    avg_leg_km: float, max_iterations: int
) -> tuple[float, float]:
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
    polish: Callable[[Any], Any] | None = None,
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

        if current_obj < best_obj - 1e-9:
            # Local search on every new best: ALNS explores, LS exploits.
            if polish is not None:
                current = polish(current)
                current_obj = current.objective()
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
                d_after = _haversine_distance(
                    route[i - 1], route[j]
                ) + _haversine_distance(route[i], route[j + 1])
                if d_after < d_before - 1e-10:
                    route[i : j + 1] = route[i : j + 1][::-1]
                    # route[i] changed — refresh the cached edge or later
                    # comparisons accept moves that lengthen the route.
                    d_i_prev = _haversine_distance(route[i - 1], route[i])
                    improved = True

    return route[1:-1]


def _or_opt(stops: list[Stop], depot: Stop) -> tuple[list[Stop], bool]:
    """
    Or-opt: move a segment of 1-3 consecutive stops (optionally reversed) to
    the cheapest other position. Catches moves 2-opt cannot express, like
    relocating a single out-of-place stop. Returns (new_stops, improved).
    """
    route = [depot] + list(stops) + [depot]
    improved = False
    for seg_len in (1, 2, 3):
        i = 1
        while i + seg_len < len(route):
            seg = route[i : i + seg_len]
            prev, nxt = route[i - 1], route[i + seg_len]
            removal_gain = (
                _haversine_distance(prev, seg[0])
                + _haversine_distance(seg[-1], nxt)
                - _haversine_distance(prev, nxt)
            )
            rest = route[:i] + route[i + seg_len :]
            best_delta = -1e-10
            best_move = None
            for j in range(len(rest) - 1):
                p, q = rest[j], rest[j + 1]
                base = _haversine_distance(p, q)
                for cand in (seg, seg[::-1]):
                    delta = (
                        _haversine_distance(p, cand[0])
                        + _haversine_distance(cand[-1], q)
                        - base
                        - removal_gain
                    )
                    if delta < best_delta:
                        best_delta = delta
                        best_move = (j, cand)
            if best_move is not None:
                j, cand = best_move
                route = rest[: j + 1] + cand + rest[j + 1 :]
                improved = True
            else:
                i += 1
    return route[1:-1], improved


def _local_search(stops: list[Stop], depot: Stop) -> list[Stop]:
    """Alternate 2-opt and or-opt until neither finds an improvement."""
    stops = _two_opt(stops, depot)
    while True:
        stops, improved = _or_opt(stops, depot)
        if not improved:
            return stops
        stops = _two_opt(stops, depot)


def _relocate_between_routes(state: "MultiRouteState") -> "MultiRouteState":  # noqa: F821
    """
    Move single stops to the cheapest slot in another route while that lowers
    the full objective (total distance + makespan term).
    """
    result = state.copy()
    lengths = [r.objective() for r in result.routes]
    w = result.makespan_weight

    def score(ls: list[float]) -> float:
        return sum(ls) + (w * max(ls) if w else 0.0)

    improved = True
    while improved:
        improved = False
        current_score = score(lengths)
        for ri, route in enumerate(result.routes):
            depot = route._depot()
            si = 0
            while si < len(route.stops):
                full = [depot] + route.stops + [depot]
                stop = route.stops[si]
                gain = (
                    _haversine_distance(full[si], stop)
                    + _haversine_distance(stop, full[si + 2])
                    - _haversine_distance(full[si], full[si + 2])
                )
                best = None
                for rj, other in enumerate(result.routes):
                    if rj == ri:
                        continue
                    pos, add = _best_insertion(other.stops, stop, other._depot())
                    trial = list(lengths)
                    trial[ri] -= gain
                    trial[rj] += add
                    trial_score = score(trial)
                    if trial_score < current_score - 1e-9:
                        current_score = trial_score
                        best = (rj, pos, trial)
                if best is None:
                    si += 1
                    continue
                rj, pos, lengths = best
                route.stops.pop(si)
                result.routes[rj].stops.insert(pos, stop)
                improved = True
    return result


def _polish_multi(state: "MultiRouteState") -> "MultiRouteState":  # noqa: F821
    result = _relocate_between_routes(state)
    for route in result.routes:
        route.stops = _local_search(route.stops, route._depot())
    return result


def _sweep_initial(
    stops: list[Stop], depot_lat: float, depot_lng: float, n_vehicles: int
) -> list[list[Stop]]:
    """
    Sort stops by bearing from the depot and cut them into n_vehicles
    contiguous, equally sized sectors so each rider starts with a compact area.
    """
    ordered = sorted(
        stops, key=lambda s: math.atan2(s.lat - depot_lat, s.lng - depot_lng)
    )
    chunk = math.ceil(len(ordered) / n_vehicles)
    return [ordered[k * chunk : (k + 1) * chunk] for k in range(n_vehicles)]


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
    max_iterations: int = 300,
    patience: int = 150,
    segment_size: int = 50,
    reaction: float = 0.2,
    return_to_depot: bool = True,
    distance_matrix: list[list[float]] | None = None,
) -> RouteState:
    """
    Return the best single-vehicle route found by the matrix ALNS in tsp.py.

    With return_to_depot=False the leg from the last stop back to the depot
    is free, so the solver optimises an open path (pickup -> deliveries).

    distance_matrix optionally replaces straight-line distance with any
    (N+1)x(N+1) cost matrix, depot at index 0 and stops[i] at index i + 1,
    e.g. road travel times. It may be asymmetric (one-way streets). On real
    Metro Manila road data, optimising on road time cut drive time 5-10% vs
    straight-line distance.
    """
    rng = np.random.default_rng(seed)
    if distance_matrix is None:
        dist = haversine_matrix(stops, depot_lat, depot_lng)
    else:
        if len(distance_matrix) != len(stops) + 1 or any(
            len(row) != len(stops) + 1 for row in distance_matrix
        ):
            raise ValueError("distance_matrix must be (len(stops) + 1) square")
        dist = [list(map(float, row)) for row in distance_matrix]
    if not return_to_depot:
        for row in dist:
            row[0] = 0.0

    tour = solve_tour(
        dist,
        rng,
        max_iterations=max_iterations,
        patience=patience,
        segment_size=segment_size,
        reaction=reaction,
    )
    return RouteState(
        depot_lat=depot_lat,
        depot_lng=depot_lng,
        stops=[stops[node - 1] for node in tour],
    )


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
    makespan_weight: float = 1.0,
) -> "MultiRouteState":  # noqa: F821
    """
    Run multi-vehicle ALNS and return the best MultiRouteState found.

    Minimises total distance + makespan_weight * longest route, so work is
    spread across riders instead of piling onto one.
    """
    from app.routing.operators.destroy import (
        cross_route_removal,
        knearest_removal_multi,
        random_removal_multi,
    )
    from app.routing.operators.repair import (
        cross_route_insert,
        greedy_insert_multi,
        regret2_insert_multi,
    )
    from app.routing.state import MultiRouteState

    multi_destroy = [cross_route_removal, random_removal_multi, knearest_removal_multi]
    multi_repair = [cross_route_insert, greedy_insert_multi, regret2_insert_multi]

    rng = np.random.default_rng(seed)

    current = MultiRouteState(
        routes=[
            RouteState(
                depot_lat=depot_lat,
                depot_lng=depot_lng,
                stops=_nearest_neighbour_initial(vs, depot_lat, depot_lng),
            )
            for vs in _sweep_initial(stops, depot_lat, depot_lng, n_vehicles)
        ],
        makespan_weight=makespan_weight,
    )

    avg_route_obj = current.objective() / max(1, n_vehicles)
    legs = max(2, max(len(r.stops) for r in current.routes) + 1)
    avg_leg_km = max(1e-6, avg_route_obj / legs)
    start_temp, step = _compute_temp_schedule(avg_leg_km, max_iterations)

    best = _run_sa_loop(
        current,
        multi_destroy,
        multi_repair,
        rng,
        max_iterations,
        segment_size,
        reaction,
        start_temp,
        step,
        polish=_polish_multi,
    )
    return _polish_multi(best)

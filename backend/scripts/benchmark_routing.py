"""
Benchmark: ALNS with Haversine distance vs ALNS with OSRM road distance.

Depot:  Legazpi Village, Makati (realistic merchant location).
Stops:  8 customer addresses spread across Metro Manila to stress-test the
        difference between straight-line and actual road routing.

Both runs use identical ALNS mechanics (same seed, operators, iterations).
Final routes are evaluated with real OSRM road distances so the comparison
is always on the same objective regardless of which distance was used during
the search.
"""

import math
import sys
import time
from typing import Callable

import numpy as np
import requests

# ---------------------------------------------------------------------------
# Test data
# ---------------------------------------------------------------------------

DEPOT_NAME = "Legazpi Village, Makati"
DEPOT = (14.5547, 121.0244)

STOPS: list[tuple[str, tuple[float, float]]] = [
    ("Rockwell, Makati",          (14.5637, 121.0311)),
    ("BGC 5th Ave, Taguig",       (14.5501, 121.0506)),
    ("Ortigas Center, Pasig",     (14.5876, 121.0577)),
    ("Shaw Blvd, Mandaluyong",    (14.5810, 121.0331)),
    ("Ermita, Manila",            (14.5775, 120.9815)),
    ("Binondo, Manila",           (14.5993, 120.9728)),
    ("Cubao, Quezon City",        (14.6192, 121.0522)),
    ("Pasay Rotonda, Pasay",      (14.5345, 121.0013)),
]

STOP_NAMES  = [s[0] for s in STOPS]
STOP_COORDS = [s[1] for s in STOPS]

# index 0 = depot, 1..N = customer stops
ALL_COORDS: list[tuple[float, float]] = [DEPOT] + STOP_COORDS
N_STOPS = len(STOPS)

# ---------------------------------------------------------------------------
# OSRM helpers
# ---------------------------------------------------------------------------

_OSRM_BASE = "http://router.project-osrm.org"


def _coord_str(indices: list[int]) -> str:
    return ";".join(f"{ALL_COORDS[i][1]},{ALL_COORDS[i][0]}" for i in indices)


def fetch_distance_matrix() -> list[list[float]]:
    """Return NxN road distance matrix in km via OSRM table API."""
    all_indices = list(range(len(ALL_COORDS)))
    url = f"{_OSRM_BASE}/table/v1/driving/{_coord_str(all_indices)}"
    resp = requests.get(url, params={"annotations": "distance"}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM table error: {data.get('code')}")
    return [[d / 1000.0 for d in row] for row in data["distances"]]


def fetch_route_km(ordered_indices: list[int]) -> float:
    """Return actual road distance in km for depot->stops->depot via OSRM route API."""
    route = [0] + ordered_indices + [0]
    url = f"{_OSRM_BASE}/route/v1/driving/{_coord_str(route)}"
    resp = requests.get(url, params={"overview": "false"}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM route error: {data.get('code')}")
    return data["routes"][0]["distance"] / 1000.0


# ---------------------------------------------------------------------------
# Distance functions
# ---------------------------------------------------------------------------

def haversine(a: int, b: int) -> float:
    lat1, lng1 = ALL_COORDS[a]
    lat2, lng2 = ALL_COORDS[b]
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def make_matrix_dist(matrix: list[list[float]]) -> Callable[[int, int], float]:
    def dist(a: int, b: int) -> float:
        return matrix[a][b]
    return dist


# ---------------------------------------------------------------------------
# Self-contained ALNS
# ---------------------------------------------------------------------------

def _route_cost(order: list[int], dist: Callable) -> float:
    if not order:
        return 0.0
    full = [0] + order + [0]
    return sum(dist(full[i], full[i + 1]) for i in range(len(full) - 1))


def _best_insert(order: list[int], stop: int, dist: Callable) -> tuple[int, float]:
    best_pos, best_delta = 0, float("inf")
    full = [0] + order + [0]
    for i in range(1, len(full)):
        delta = dist(full[i - 1], stop) + dist(stop, full[i]) - dist(full[i - 1], full[i])
        if delta < best_delta:
            best_delta = delta
            best_pos = i - 1
    return best_pos, best_delta


def _two_opt(order: list[int], dist: Callable) -> list[int]:
    route = [0] + list(order) + [0]
    improved = True
    while improved:
        improved = False
        for i in range(1, len(route) - 2):
            for j in range(i + 1, len(route) - 1):
                before = dist(route[i - 1], route[i]) + dist(route[j], route[j + 1])
                after  = dist(route[i - 1], route[j]) + dist(route[i], route[j + 1])
                if after < before - 1e-10:
                    route[i : j + 1] = route[i : j + 1][::-1]
                    improved = True
    return route[1:-1]


def alns_solve(
    stop_indices: list[int],
    dist: Callable,
    seed: int = 42,
    iterations: int = 2_000,
) -> list[int]:
    """
    Minimal ALNS: nearest-neighbour init, random removal, greedy + regret-2 repair,
    simulated annealing acceptance, 2-opt polish. Depot is always index 0.
    """
    rng = np.random.default_rng(seed)

    # Nearest-neighbour initial solution
    remaining = list(stop_indices)
    current_idx = 0
    nn: list[int] = []
    while remaining:
        nxt = min(remaining, key=lambda s: dist(current_idx, s))
        nn.append(nxt)
        remaining.remove(nxt)
        current_idx = nxt

    current = nn
    current_cost = _route_cost(current, dist)
    best = list(current)
    best_cost = current_cost

    legs = max(2, len(current) + 1)
    start_temp = max(0.5, current_cost / legs)
    end_temp = max(0.01, start_temp * 0.01)
    step = (end_temp / start_temp) ** (1.0 / max(1, iterations - 1))
    temp = start_temp

    # Operator weights (destroy: random, worst | repair: greedy, regret-2)
    d_w = [1.0, 1.0]
    r_w = [1.0, 1.0]
    reaction = 0.4
    segment = 100

    def roulette(weights: list[float]) -> int:
        total = sum(weights)
        pick = rng.random() * total
        cum = 0.0
        for k, w in enumerate(weights):
            cum += w
            if pick <= cum:
                return k
        return len(weights) - 1

    def regret2(order: list[int], stops_pool: list[int]) -> list[int]:
        result = list(order)
        pool = list(stops_pool)
        while pool:
            best_stop, best_pos_, best_regret = pool[0], 0, -float("inf")
            for s in pool:
                full = [0] + result + [0]
                costs = sorted(
                    dist(full[i - 1], s) + dist(s, full[i]) - dist(full[i - 1], full[i])
                    for i in range(1, len(full))
                )
                regret = (costs[1] - costs[0]) if len(costs) > 1 else 0.0
                if regret > best_regret:
                    best_regret = regret
                    best_stop = s
                    best_pos_, _ = _best_insert(result, s, dist)
            pool.remove(best_stop)
            result.insert(best_pos_, best_stop)
        return result

    for i in range(iterations):
        d_idx = roulette(d_w)
        r_idx = roulette(r_w)

        # Destroy
        n_remove = max(1, int(len(current) * rng.uniform(0.1, 0.3)))
        rm_indices = set(rng.choice(len(current), size=min(n_remove, len(current)), replace=False).tolist())
        removed = [current[k] for k in sorted(rm_indices)]
        partial = [s for k, s in enumerate(current) if k not in rm_indices]

        # Repair
        rng.shuffle(removed)
        if r_idx == 0:  # greedy
            for s in removed:
                pos, _ = _best_insert(partial, s, dist)
                partial.insert(pos, s)
            candidate = partial
        else:  # regret-2
            candidate = regret2(partial, removed)

        candidate_cost = _route_cost(candidate, dist)
        delta = candidate_cost - current_cost
        accepted = delta < 0 or rng.random() < math.exp(-delta / max(temp, 1e-10))

        if accepted:
            current = candidate
            current_cost = candidate_cost

        if current_cost < best_cost:
            best = list(current)
            best_cost = current_cost
            score = 10.0
        elif accepted and delta < 0:
            score = 5.0
        elif accepted:
            score = 2.0
        else:
            score = 0.0

        d_w[d_idx] = (1 - reaction) * d_w[d_idx] + reaction * score
        r_w[r_idx] = (1 - reaction) * r_w[r_idx] + reaction * score

        if (i + 1) % segment == 0:
            d_w = [1.0, 1.0]
            r_w = [1.0, 1.0]

        temp *= step

    return _two_opt(best, dist)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def print_route(label: str, order: list[int], hav_km: float, road_km: float) -> None:
    names = " -> ".join(STOP_NAMES[i - 1] for i in order)
    print(f"\n  {label}")
    print(f"    Order : {names}")
    print(f"    Haversine total : {hav_km:.2f} km  (straight-line)")
    print(f"    Road total      : {road_km:.2f} km  (OSRM actual)")
    print(f"    Road/Haversine  : {road_km / hav_km:.2f}x")


def main() -> None:
    stop_indices = list(range(1, N_STOPS + 1))

    print("Fetching OSRM road distance matrix …", flush=True)
    try:
        matrix = fetch_distance_matrix()
    except Exception as exc:
        print(f"OSRM unavailable: {exc}", file=sys.stderr)
        sys.exit(1)

    road_dist = make_matrix_dist(matrix)
    print("Matrix fetched.\n")

    # --- Run both solvers ---
    print("Running ALNS (Haversine) …", flush=True)
    t0 = time.perf_counter()
    h_order = alns_solve(stop_indices, haversine, seed=42, iterations=2_000)
    h_solve_ms = (time.perf_counter() - t0) * 1000

    print("Running ALNS (Road distance) …", flush=True)
    t0 = time.perf_counter()
    r_order = alns_solve(stop_indices, road_dist, seed=42, iterations=2_000)
    r_solve_ms = (time.perf_counter() - t0) * 1000

    # --- Evaluate both routes on road distances ---
    print("Evaluating routes via OSRM …", flush=True)
    h_road_km = fetch_route_km(h_order)
    r_road_km = fetch_route_km(r_order)

    # Haversine totals for reference
    h_hav_km = _route_cost(h_order, haversine)
    r_hav_km = _route_cost(r_order, haversine)

    # --- Print results ---
    width = 64
    print("\n" + "=" * width)
    print("  ALNS DISTANCE BENCHMARK — Metro Manila")
    print("=" * width)
    print(f"\n  Depot  : {DEPOT_NAME}")
    print(f"  Stops  : {N_STOPS}")
    print(f"  Solver : 2 000 iterations, same seed (42), same operators")

    print_route("Haversine ALNS", h_order, h_hav_km, h_road_km)
    print_route("Road-dist ALNS", r_order, r_hav_km, r_road_km)

    same_order = h_order == r_order
    diff_km = h_road_km - r_road_km
    diff_pct = (diff_km / h_road_km) * 100 if h_road_km else 0.0

    print("\n" + "-" * width)
    print(f"  Same stop order     : {same_order}")
    print(f"  Road distance delta : {diff_km:+.2f} km  ({diff_pct:+.1f}%)")
    print(f"  Solve time (Hav)    : {h_solve_ms:.0f} ms")
    print(f"  Solve time (Road)   : {r_solve_ms:.0f} ms  (matrix lookup, no API calls during search)")
    print("=" * width)

    if same_order:
        print("\n  Verdict  Identical orderings — Haversine produces the same route.")
        print("           Straight-line distance is a sufficient proxy for this area.")
    elif abs(diff_km) < 1.0:
        print(f"\n  Verdict  Different orderings but road distance gap is small ({abs(diff_km):.2f} km).")
        print("           Haversine is a reasonable approximation.")
    else:
        print(f"\n  Verdict  Road-distance ALNS saves {abs(diff_km):.2f} km ({abs(diff_pct):.1f}%) on actual roads.")
        print("           Haversine-based ordering introduces measurable inefficiency.")

    print()


if __name__ == "__main__":
    main()

"""
Mapbox Matrix API vs OSRM — head-to-head comparison.

Same 8 Metro Manila stops, same ALNS (seed 42, 2 000 iters).
Measures:
  - Fetch latency for each matrix source
  - Element-wise distance divergence between sources
  - Whether the optimal route ordering differs
  - Final road distance of each route (evaluated by both sources)
  - Mapbox driving-traffic vs driving-static (same API, different profile)
"""

import math
import os
import sys
import time
from typing import Callable

import numpy as np
import requests
from dotenv import load_dotenv

load_dotenv()

MAPBOX_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN", "")
if not MAPBOX_TOKEN:
    print("MAPBOX_ACCESS_TOKEN not set in .env", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Test data — same as benchmark_routing.py
# ---------------------------------------------------------------------------

DEPOT_NAME = "Legazpi Village, Makati"
DEPOT = (14.5547, 121.0244)

STOPS: list[tuple[str, tuple[float, float]]] = [
    ("Rockwell, Makati",       (14.5637, 121.0311)),
    ("BGC 5th Ave, Taguig",    (14.5501, 121.0506)),
    ("Ortigas Center, Pasig",  (14.5876, 121.0577)),
    ("Shaw Blvd, Mandaluyong", (14.5810, 121.0331)),
    ("Ermita, Manila",         (14.5775, 120.9815)),
    ("Binondo, Manila",        (14.5993, 120.9728)),
    ("Cubao, Quezon City",     (14.6192, 121.0522)),
    ("Pasay Rotonda, Pasay",   (14.5345, 121.0013)),
]

STOP_NAMES  = [s[0] for s in STOPS]
STOP_COORDS = [s[1] for s in STOPS]
ALL_COORDS  = [DEPOT] + STOP_COORDS
N = len(ALL_COORDS)


# ---------------------------------------------------------------------------
# Matrix fetchers
# ---------------------------------------------------------------------------

def _osrm_coord_str(indices: list[int]) -> str:
    return ";".join(f"{ALL_COORDS[i][1]},{ALL_COORDS[i][0]}" for i in indices)


def fetch_osrm(timeout: int = 20) -> tuple[list[list[float]], float]:
    """Returns (distance_matrix_km, latency_ms)."""
    url = f"http://router.project-osrm.org/table/v1/driving/{_osrm_coord_str(list(range(N)))}"
    t0 = time.perf_counter()
    resp = requests.get(url, params={"annotations": "distance"}, timeout=timeout)
    latency_ms = (time.perf_counter() - t0) * 1000
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM: {data.get('code')}")
    matrix = [[d / 1000.0 for d in row] for row in data["distances"]]
    return matrix, latency_ms


def _mapbox_coord_str(indices: list[int]) -> str:
    return ";".join(f"{ALL_COORDS[i][1]},{ALL_COORDS[i][0]}" for i in indices)


def fetch_mapbox(profile: str = "driving", timeout: int = 20) -> tuple[list[list[float]], float]:
    """Returns (distance_matrix_km, latency_ms). profile: 'driving' or 'driving-traffic'."""
    coords = _mapbox_coord_str(list(range(N)))
    url = f"https://api.mapbox.com/directions-matrix/v1/mapbox/{profile}/{coords}"
    t0 = time.perf_counter()
    resp = requests.get(
        url,
        params={"annotations": "distance", "access_token": MAPBOX_TOKEN},
        timeout=timeout,
    )
    latency_ms = (time.perf_counter() - t0) * 1000
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok":
        raise RuntimeError(f"Mapbox ({profile}): {data.get('code')} — {data.get('message', '')}")
    matrix = [[d / 1000.0 for d in row] for row in data["distances"]]
    return matrix, latency_ms


# ---------------------------------------------------------------------------
# Evaluation: actual road distance via Mapbox Directions
# ---------------------------------------------------------------------------

def route_km_mapbox(ordered_indices: list[int], profile: str = "driving") -> float:
    """Actual road distance in km for depot->stops->depot via Mapbox Directions."""
    route = [0] + ordered_indices + [0]
    coords = ";".join(f"{ALL_COORDS[i][1]},{ALL_COORDS[i][0]}" for i in route)
    url = f"https://api.mapbox.com/directions/v5/mapbox/{profile}/{coords}"
    resp = requests.get(
        url,
        params={"overview": "false", "access_token": MAPBOX_TOKEN},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    if data.get("code") != "Ok":
        raise RuntimeError(f"Mapbox directions: {data.get('code')}")
    return data["routes"][0]["distance"] / 1000.0


def route_km_osrm(ordered_indices: list[int]) -> float:
    """Actual road distance in km for depot->stops->depot via OSRM route."""
    route = [0] + ordered_indices + [0]
    url = f"http://router.project-osrm.org/route/v1/driving/{_osrm_coord_str(route)}"
    resp = requests.get(url, params={"overview": "false"}, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    return data["routes"][0]["distance"] / 1000.0


# ---------------------------------------------------------------------------
# ALNS (same as benchmark_routing.py)
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


def alns_solve(stop_indices: list[int], dist: Callable, seed: int = 42, iters: int = 2_000) -> list[int]:
    rng = np.random.default_rng(seed)

    remaining = list(stop_indices)
    cur = 0
    nn: list[int] = []
    while remaining:
        nxt = min(remaining, key=lambda s: dist(cur, s))
        nn.append(nxt)
        remaining.remove(nxt)
        cur = nxt

    current = nn
    current_cost = _route_cost(current, dist)
    best = list(current)
    best_cost = current_cost

    legs = max(2, len(current) + 1)
    start_temp = max(0.5, current_cost / legs)
    end_temp = max(0.01, start_temp * 0.01)
    step = (end_temp / start_temp) ** (1.0 / max(1, iters - 1))
    temp = start_temp
    d_w, r_w = [1.0, 1.0], [1.0, 1.0]
    reaction, segment = 0.4, 100

    def roulette(w: list[float]) -> int:
        total = sum(w)
        pick = rng.random() * total
        cum = 0.0
        for k, wk in enumerate(w):
            cum += wk
            if pick <= cum:
                return k
        return len(w) - 1

    for i in range(iters):
        d_idx = roulette(d_w)
        r_idx = roulette(r_w)

        n_rm = max(1, int(len(current) * rng.uniform(0.1, 0.3)))
        rm = set(rng.choice(len(current), size=min(n_rm, len(current)), replace=False).tolist())
        removed = [current[k] for k in sorted(rm)]
        partial = [s for k, s in enumerate(current) if k not in rm]

        rng.shuffle(removed)
        if r_idx == 0:
            for s in removed:
                pos, _ = _best_insert(partial, s, dist)
                partial.insert(pos, s)
            candidate = partial
        else:
            pool = list(removed)
            result = list(partial)
            while pool:
                best_s, best_p, best_reg = pool[0], 0, -float("inf")
                for s in pool:
                    full = [0] + result + [0]
                    costs = sorted(
                        dist(full[k - 1], s) + dist(s, full[k]) - dist(full[k - 1], full[k])
                        for k in range(1, len(full))
                    )
                    reg = (costs[1] - costs[0]) if len(costs) > 1 else 0.0
                    if reg > best_reg:
                        best_reg = reg
                        best_s = s
                        best_p, _ = _best_insert(result, s, dist)
                pool.remove(best_s)
                result.insert(best_p, best_s)
            candidate = result

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
            d_w, r_w = [1.0, 1.0], [1.0, 1.0]

        temp *= step

    return _two_opt(best, dist)


# ---------------------------------------------------------------------------
# Matrix stats helpers
# ---------------------------------------------------------------------------

def matrix_stats(m1: list[list[float]], m2: list[list[float]], label1: str, label2: str) -> None:
    diffs, ratios = [], []
    for i in range(N):
        for j in range(N):
            if i == j:
                continue
            d1, d2 = m1[i][j], m2[i][j]
            if d1 > 0 and d2 > 0:
                diffs.append(abs(d1 - d2))
                ratios.append(d2 / d1)

    mean_diff = sum(diffs) / len(diffs)
    max_diff  = max(diffs)
    mean_ratio = sum(ratios) / len(ratios)

    # Worst-case pair
    worst_val, worst_i, worst_j = 0.0, 0, 0
    for i in range(N):
        for j in range(N):
            if i != j:
                d = abs(m1[i][j] - m2[i][j])
                if d > worst_val:
                    worst_val, worst_i, worst_j = d, i, j

    n1 = "depot" if worst_i == 0 else STOP_NAMES[worst_i - 1]
    n2 = "depot" if worst_j == 0 else STOP_NAMES[worst_j - 1]

    print(f"\n  {label1} vs {label2}")
    print(f"    Mean absolute diff  : {mean_diff:.3f} km")
    print(f"    Max absolute diff   : {max_diff:.3f} km  ({n1} -> {n2})")
    print(f"    Mean ratio ({label2}/{label1}): {mean_ratio:.3f}x")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def fmt_route(order: list[int]) -> str:
    return " -> ".join(STOP_NAMES[i - 1] for i in order)


def main() -> None:
    stop_indices = list(range(1, N))
    WIDTH = 68

    print("Fetching matrices ...", flush=True)

    print("  [1/3] OSRM ...")
    osrm_matrix, osrm_lat = fetch_osrm()

    print("  [2/3] Mapbox driving (static) ...")
    mb_matrix, mb_lat = fetch_mapbox("driving")

    print("  [3/3] Mapbox driving-traffic (live) ...")
    try:
        mbt_matrix, mbt_lat = fetch_mapbox("driving-traffic")
        has_traffic = True
    except Exception as exc:
        print(f"    driving-traffic unavailable ({exc}) — skipping")
        has_traffic = False

    print("\nRunning ALNS solvers ...", flush=True)

    def make_dist(matrix: list[list[float]]) -> Callable:
        def d(a: int, b: int) -> float:
            return matrix[a][b]
        return d

    t0 = time.perf_counter()
    osrm_order  = alns_solve(stop_indices, make_dist(osrm_matrix),  seed=42)
    osrm_ms = (time.perf_counter() - t0) * 1000

    t0 = time.perf_counter()
    mb_order    = alns_solve(stop_indices, make_dist(mb_matrix),    seed=42)
    mb_ms = (time.perf_counter() - t0) * 1000

    if has_traffic:
        t0 = time.perf_counter()
        mbt_order = alns_solve(stop_indices, make_dist(mbt_matrix), seed=42)
        mbt_ms = (time.perf_counter() - t0) * 1000

    print("Evaluating routes (Mapbox Directions + OSRM Route) ...", flush=True)

    # Evaluate every produced route with both evaluators for cross-checking
    osrm_road = route_km_osrm(osrm_order)
    mb_road   = route_km_mapbox(mb_order, "driving")

    # Cross-evaluate: each route measured by the other source
    osrm_vs_mb   = route_km_mapbox(osrm_order, "driving")
    mb_vs_osrm   = route_km_osrm(mb_order)

    if has_traffic:
        mbt_road     = route_km_mapbox(mbt_order, "driving-traffic")
        mbt_vs_mb    = route_km_mapbox(mbt_order, "driving")

    # -----------------------------------------------------------------------
    print("\n" + "=" * WIDTH)
    print("  MAPBOX MATRIX vs OSRM — Metro Manila Benchmark")
    print("=" * WIDTH)
    print(f"\n  Depot : {DEPOT_NAME}   |   {N - 1} customer stops")
    print(f"  ALNS  : 2 000 iterations, seed 42, identical operators")

    # --- Latency ---
    print(f"\n  {'SOURCE':<32} {'FETCH LATENCY':>14}  {'SOLVE TIME':>10}")
    print(f"  {'-'*32} {'-'*14}  {'-'*10}")
    print(f"  {'OSRM (public demo)':<32} {osrm_lat:>12.0f}ms  {osrm_ms:>8.0f}ms")
    print(f"  {'Mapbox driving (static)':<32} {mb_lat:>12.0f}ms  {mb_ms:>8.0f}ms")
    if has_traffic:
        print(f"  {'Mapbox driving-traffic (live)':<32} {mbt_lat:>12.0f}ms  {mbt_ms:>8.0f}ms")

    # --- Matrix divergence ---
    print(f"\n  MATRIX DIVERGENCE (element-wise, {N}x{N} grid, off-diagonal only)")
    print(f"  {'-'*60}")
    matrix_stats(osrm_matrix, mb_matrix, "OSRM", "Mapbox")
    if has_traffic:
        matrix_stats(mb_matrix, mbt_matrix, "Mapbox", "Mapbox-traffic")

    # --- Routes ---
    print(f"\n  ROUTES")
    print(f"  {'-'*60}")
    print(f"\n  OSRM route  :  {fmt_route(osrm_order)}")
    print(f"  Mapbox route:  {fmt_route(mb_order)}")
    if has_traffic:
        print(f"  Mb-traffic  :  {fmt_route(mbt_order)}")

    print(f"\n  {'ROUTE':<20} {'OSRM eval':>10} {'Mapbox eval':>12} {'same order?':>12}")
    print(f"  {'-'*20} {'-'*10}  {'-'*12}  {'-'*12}")
    print(f"  {'OSRM route':<20} {osrm_road:>9.2f}km  {osrm_vs_mb:>11.2f}km  {'—':>12}")
    print(f"  {'Mapbox route':<20} {mb_vs_osrm:>9.2f}km  {mb_road:>11.2f}km  {str(mb_order == osrm_order):>12}")
    if has_traffic:
        print(f"  {'Mb-traffic route':<20} {'—':>9}    {mbt_vs_mb:>11.2f}km  {str(mbt_order == mb_order):>12}")

    # --- Verdict ---
    print(f"\n  {'=' * 60}")
    print("  VERDICT")
    print(f"  {'-'*60}")

    # Route quality gap
    gap_km  = osrm_vs_mb - mb_road
    gap_pct = abs(gap_km) / mb_road * 100 if mb_road else 0

    if osrm_order == mb_order:
        print("  Ordering: identical — both sources agree on the optimal route.")
    else:
        if abs(gap_km) < 0.5:
            print(f"  Ordering: different, but road distance gap is negligible ({gap_km:+.2f} km).")
        else:
            better = "Mapbox" if gap_km > 0 else "OSRM"
            print(f"  Ordering: different — {better} route is {abs(gap_km):.2f} km shorter ({gap_pct:.1f}%) by Mapbox eval.")

    # Latency trade-off
    lat_diff = mb_lat - osrm_lat
    if lat_diff > 0:
        print(f"  Latency : Mapbox is {lat_diff:.0f}ms slower to fetch (authentication + CDN overhead).")
    else:
        print(f"  Latency : Mapbox is {abs(lat_diff):.0f}ms faster to fetch.")

    print( "  Cost    : OSRM public is free / self-hostable. Mapbox charges per")
    print( "            matrix element (~$0.05/1 000 elements after free tier).")
    print( "            A 9x9 matrix = 81 elements = $0.004 per shipment batch.")

    if has_traffic:
        traffic_gap = mbt_vs_mb - mb_road
        print(f"  Traffic : driving-traffic route is {traffic_gap:+.2f} km vs static Mapbox —", end=" ")
        if abs(traffic_gap) < 0.3:
            print("negligible for this area at this time.")
        elif traffic_gap > 0:
            print("traffic routing adds distance (avoids congested shortcuts).")
        else:
            print("traffic routing finds a shorter path by avoiding congestion.")

    print()


if __name__ == "__main__":
    main()

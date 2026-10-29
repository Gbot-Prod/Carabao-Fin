"""
Benchmark: ALNS multi-drop routing vs simple point-to-point / batching baselines.

Scenario: one merchant pickup, N customer drop-offs, rider does not return.
Data:     84 real Metro Manila delivery locations around two pickup hubs
          (Farmers Market Cubao, Market! Market! BGC), geocoded with
          OpenStreetMap; travel times and distances are real OSRM road
          values (asymmetric: one-way streets). Cached in
          scripts/data/metro_manila_osrm.json, so this runs offline.

Strategies, all evaluated on the same road travel times:
  point_to_point  one trip per order: pickup -> customer -> back to pickup
  batch_fifo      one trip, stops in the order they were received
  nearest_next    one trip, always drive to the closest remaining stop
  nn_2opt         nearest_next improved with 2-opt (a standard simple heuristic)
  alns            production solver (compute_route with the road time matrix)

Metrics (driving only; time spent at each door is the same for every strategy
except point-to-point, where it would make the gap larger):
  drive_min   total rider driving time until the last delivery
  km          total road distance
  wait_min    average time from pickup until each customer receives their order
  last_min    time until the final customer receives their order

Run:  uv run python scripts/benchmark_vs_baselines.py [--batches 50] [--json out.json]
"""

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

import numpy as np

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.routing import tsp  # noqa: E402
from app.routing.service import compute_route  # noqa: E402
from app.routing.state import Stop  # noqa: E402

DATA = BACKEND_ROOT / "scripts" / "data" / "metro_manila_osrm.json"
SIZES = (5, 10, 15, 20)
STRATEGIES = ("point_to_point", "batch_fifo", "nearest_next", "nn_2opt", "alns")
LABELS = {
    "point_to_point": "Point-to-point (1 trip/order)",
    "batch_fifo": "Batched, order received",
    "nearest_next": "Batched, nearest next stop",
    "nn_2opt": "Nearest next stop + 2-opt",
    "alns": "ALNS (Carabao)",
}


# ---------------------------------------------------------------------------
# Strategies: each returns (drive_min, km, arrival times per customer)
# ---------------------------------------------------------------------------


def _evaluate_path(tour, dur, dist):
    t = km = 0.0
    arrivals = []
    prev = 0
    for node in tour:
        t += dur[prev][node]
        km += dist[prev][node]
        arrivals.append(t)
        prev = node
    return t, km, arrivals


def point_to_point(n, dur, dist):
    t = km = 0.0
    arrivals = []
    for node in range(1, n + 1):
        arrivals.append(t + dur[0][node])
        t += dur[0][node] + dur[node][0]
        km += dist[0][node] + dist[node][0]
    # The rider does not need to come back after the final delivery.
    return t - dur[n][0], km - dist[n][0], arrivals


def _nearest_next(n, dur):
    left = set(range(1, n + 1))
    tour, current = [], 0
    while left:
        current = min(left, key=dur[current].__getitem__)
        tour.append(current)
        left.remove(current)
    return tour


def _open(matrix):
    """No cost for the return leg: the route ends at the last customer."""
    return [[0.0 if j == 0 else v for j, v in enumerate(row)] for row in matrix]


def run_strategies(region_pool, idx):
    dur = [[region_pool["duration_min"][i][j] for j in idx] for i in idx]
    dist = [[region_pool["distance_km"][i][j] for j in idx] for i in idx]
    n = len(idx) - 1
    out = {"point_to_point": point_to_point(n, dur, dist)}
    out["batch_fifo"] = _evaluate_path(list(range(1, n + 1)), dur, dist)
    nn = _nearest_next(n, dur)
    out["nearest_next"] = _evaluate_path(nn, dur, dist)
    out["nn_2opt"] = _evaluate_path(tsp.two_opt(nn, _open(dur)), dur, dist)

    pts = [region_pool["points"][i] for i in idx]
    stops = [
        Stop(order_id=k, merchant_id=1, lat=lat, lng=lng)
        for k, (lat, lng) in enumerate(pts[1:], start=1)
    ]
    t0 = time.perf_counter()
    ordered = compute_route(stops, pts[0][0], pts[0][1], distance_matrix=dur)
    solve_ms = (time.perf_counter() - t0) * 1000
    out["alns"] = _evaluate_path([s.order_id for s in ordered], dur, dist)
    return out, solve_ms


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batches", type=int, default=50, help="per size per hub")
    parser.add_argument("--json", type=Path, help="write raw results here")
    args = parser.parse_args()

    pools = json.loads(DATA.read_text())
    rng = np.random.default_rng(2026)
    rows = []
    for size in SIZES:
        for region, pool in pools.items():
            n_all = len(pool["points"]) - 1
            for b in range(args.batches):
                # Random customers, in a random "order received" sequence.
                picked = rng.choice(np.arange(1, n_all + 1), size, replace=False)
                res, solve_ms = run_strategies(pool, [0] + picked.tolist())
                rows.append(
                    {
                        "size": size,
                        "hub": region,
                        "batch": b,
                        "solve_ms": solve_ms,
                        **{
                            s: {
                                "drive_min": res[s][0],
                                "km": res[s][1],
                                "wait_min": sum(res[s][2]) / len(res[s][2]),
                                "last_min": max(res[s][2]),
                            }
                            for s in STRATEGIES
                        },
                    }
                )

    print("ALNS vs simpler strategies on real Metro Manila road data")
    print(f"{args.batches} random batches per size per hub (2 hubs)\n")
    for size in SIZES:
        group = [r for r in rows if r["size"] == size]
        print(f"=== {size} drop-offs ({len(group)} batches) ===")
        print(
            f"  {'strategy':32s}{'drive':>9s}{'km':>8s}{'avg wait':>10s}"
            f"{'last drop':>11s}   ALNS saves (drive)"
        )
        for s in STRATEGIES:

            def mean(metric, s=s, group=group):
                return statistics.mean(r[s][metric] for r in group)

            if s == "alns":
                saving = ""
            else:
                cuts = [
                    1 - r["alns"]["drive_min"] / r[s]["drive_min"]
                    for r in group
                    if r[s]["drive_min"] > 0
                ]
                wins = sum(
                    r["alns"]["drive_min"] <= r[s]["drive_min"] + 1e-9 for r in group
                )
                saving = (
                    f"{100 * statistics.mean(cuts):5.1f}% avg, "
                    f"ALNS <= baseline in {wins}/{len(group)}"
                )
            print(
                f"  {LABELS[s]:32s}{mean('drive_min'):7.1f}m{mean('km'):8.1f}"
                f"{mean('wait_min'):9.1f}m{mean('last_min'):10.1f}m   {saving}"
            )
        ms = [r["solve_ms"] for r in group]
        print(
            f"  ALNS solve time: {statistics.mean(ms):.0f} ms avg, "
            f"{max(ms):.0f} ms max\n"
        )

    if args.json:
        args.json.write_text(json.dumps(rows))
        print(f"raw results written to {args.json}")


if __name__ == "__main__":
    main()

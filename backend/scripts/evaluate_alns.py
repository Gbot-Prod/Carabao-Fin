"""
Evaluation of the production ALNS route solver for publication.

Problem:  one pickup, N drop-offs, rider does not return (open-path asymmetric
          TSP on road travel times), i.e. what POST /merchants/me/shipments runs.
Datasets: tuning   scripts/data/metro_manila_osrm.json, the data the solver was
                   developed against (2 hubs; ~42 real geocoded customers each).
          holdout  scripts/data/metro_manila_holdout_osrm.json, never used for
                   tuning (4 other hubs; 60 random road-snapped customers each).

Stages (each writes a CSV to --out; run in this order):
  fetch       build the holdout dataset from the public OSRM server (once)
  heuristics  every heuristic on every instance, including ALNS and OR-Tools
  exact       CP-SAT proves the optimum of every instance
  crosscheck  Held-Karp dynamic programming independently verifies CP-SAT
  robust      30 ALNS seeds per instance, to measure run-to-run variation
  budget      solution quality against the iteration budget
  timing      ALNS one solve at a time on an idle machine
  exact1      CP-SAT on a single CPU core, one solve at a time

Needs extras that are deliberately not backend dependencies:
  uv run --no-project --python 3.13 --with numpy --with ortools --with scipy \
      --with requests python scripts/evaluate_alns.py <stage>
"""

import argparse
import csv
import json
import math
import sys
import time
import zlib
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path

import numpy as np

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
sys.path.insert(0, str(BACKEND_ROOT / "scripts"))

from benchmark_vs_baselines import (  # noqa: E402
    _evaluate_path,
    _nearest_next,
    _open,
    point_to_point,
)

from app.routing import tsp  # noqa: E402
from app.routing.solver import solve  # noqa: E402
from app.routing.state import Stop  # noqa: E402

DATA_DIR = BACKEND_ROOT / "scripts" / "data"
DATASETS = {
    "tuning": DATA_DIR / "metro_manila_osrm.json",
    "holdout": DATA_DIR / "metro_manila_holdout_osrm.json",
}
# 40-stop tuning batches would be near-duplicates: those pools hold ~42 customers.
SIZES = {"tuning": (5, 10, 15, 20, 30), "holdout": (5, 10, 15, 20, 30, 40)}
BATCHES_PER_SIZE = 100

# Coordinates are approximate zone centres; every customer is snapped to a road.
HOLDOUT_HUBS = {
    "divisoria": (14.6010, 120.9740),
    "balintawak": (14.6576, 121.0003),
    "marikina": (14.6325, 121.0976),
    "alabang": (14.4200, 121.0420),
}
HOLDOUT_CUSTOMERS = 60
HOLDOUT_RADIUS_KM = 7.0
MAX_SNAP_M = 150.0
OSRM_TABLE = "http://router.project-osrm.org/table/v1/driving/"

# Long enough that OR-Tools is clearly not short of time at these sizes.
ORTOOLS_LONG_MS = 2000
EXACT_LIMIT_S = 300
EXACT_WORKERS = 8
TIME_SCALE = 6000  # minutes -> integer 1/100 s, as OR-Tools needs integer costs


def stable_seed(*parts: object) -> int:
    return zlib.crc32("|".join(map(str, parts)).encode())


@lru_cache(maxsize=2)
def load(dataset: str) -> dict:
    return json.loads(DATASETS[dataset].read_text())


def instances(dataset: str, sizes=None, per_size: int = BATCHES_PER_SIZE):
    """
    Deterministic batches, split evenly over hubs. Each stage asking for the same
    batch gets the same customers, in the same random "order received" sequence.
    """
    pools = load(dataset)
    for size in sizes or SIZES[dataset]:
        for hub, pool in pools.items():
            for batch in range(per_size // len(pools)):
                rng = np.random.default_rng(stable_seed(dataset, hub, size, batch))
                picked = rng.choice(
                    np.arange(1, len(pool["points"])), size, replace=False
                )
                yield dataset, hub, size, batch, [0] + picked.tolist()


def submatrices(dataset, hub, idx):
    pool = load(dataset)[hub]
    dur = [[pool["duration_min"][i][j] for j in idx] for i in idx]
    km = [[pool["distance_km"][i][j] for j in idx] for i in idx]
    points = [pool["points"][i] for i in idx]
    return dur, km, points


def check_tour(tour, n):
    if sorted(tour) != list(range(1, n + 1)):
        raise AssertionError(f"invalid route: {tour}")


# ---------------------------------------------------------------------------
# Solvers: each takes the road-time matrix and returns a tour of node indices
# ---------------------------------------------------------------------------


def run_alns(dur, points, seed, **kwargs):
    """The production entry point; compute_route calls solve() with these defaults."""
    stops = [
        Stop(order_id=k, merchant_id=1, lat=lat, lng=lng)
        for k, (lat, lng) in enumerate(points[1:], start=1)
    ]
    state = solve(
        stops,
        points[0][0],
        points[0][1],
        seed=seed,
        return_to_depot=False,
        distance_matrix=dur,
        **kwargs,
    )
    return [s.order_id for s in state.stops]


def _integer_costs(dur):
    return [
        [0 if j == 0 else int(round(v * TIME_SCALE)) for j, v in enumerate(row)]
        for row in dur
    ]


def run_ortools(dur, time_limit_ms=None):
    """
    Google OR-Tools routing: PATH_CHEAPEST_ARC alone, or followed by Guided Local
    Search (its recommended metaheuristic) for time_limit_ms.
    """
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2

    manager = pywrapcp.RoutingIndexManager(len(dur), 1, 0)
    routing = pywrapcp.RoutingModel(manager)
    callback = routing.RegisterTransitMatrix(_integer_costs(dur))
    routing.SetArcCostEvaluatorOfAllVehicles(callback)
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    if time_limit_ms is not None:
        params.local_search_metaheuristic = (
            routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        )
        params.time_limit.FromMilliseconds(max(1, int(time_limit_ms)))
    solution = routing.SolveWithParameters(params)
    if solution is None:
        raise RuntimeError("OR-Tools found no solution")
    tour, index = [], solution.Value(routing.NextVar(routing.Start(0)))
    while not routing.IsEnd(index):
        tour.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))
    return tour


def run_exact(dur, hint, workers=EXACT_WORKERS):
    """CP-SAT circuit model. Returns (tour, status, integer bound on the optimum)."""
    from ortools.sat.python import cp_model

    costs = _integer_costs(dur)
    n = len(dur)
    model = cp_model.CpModel()
    arcs, terms, literal = [], [], {}
    for i in range(n):
        for j in range(n):
            if i != j:
                lit = model.NewBoolVar(f"{i}_{j}")
                literal[i, j] = lit
                arcs.append((i, j, lit))
                terms.append(costs[i][j] * lit)
    model.AddCircuit(arcs)
    model.Minimize(sum(terms))
    # A warm start only speeds up the proof; it cannot change the optimum.
    hinted = {(a, b) for a, b in zip([0] + hint, hint + [0], strict=True)}
    for key, lit in literal.items():
        model.AddHint(lit, int(key in hinted))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = EXACT_LIMIT_S
    solver.parameters.num_workers = workers
    status = solver.Solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(f"CP-SAT status {solver.StatusName(status)}")
    successor = {i: j for (i, j), lit in literal.items() if solver.Value(lit)}
    tour, node = [], successor[0]
    while node != 0:
        tour.append(node)
        node = successor[node]
    return tour, solver.StatusName(status), solver.BestObjectiveBound() / TIME_SCALE


def held_karp(dur):
    """Exact open-path dynamic programme, O(2^n n^2). Only for small n."""
    n = len(dur) - 1
    best = {(1 << j, j): dur[0][j + 1] for j in range(n)}
    for mask in range(1, 1 << n):
        for last in range(n):
            cost = best.get((mask, last))
            if cost is None:
                continue
            for nxt in range(n):
                if mask >> nxt & 1:
                    continue
                key = (mask | 1 << nxt, nxt)
                candidate = cost + dur[last + 1][nxt + 1]
                if candidate < best.get(key, math.inf):
                    best[key] = candidate
    return min(best[(1 << n) - 1, last] for last in range(n))


# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------


def row(job, algo, tour, dur, km, solve_ms):
    dataset, hub, size, batch, _ = job
    check_tour(tour, size)
    drive, dist, arrivals = _evaluate_path(tour, dur, km)
    return {
        "dataset": dataset,
        "hub": hub,
        "size": size,
        "batch": batch,
        "algo": algo,
        "drive_min": drive,
        "km": dist,
        "avg_wait_min": sum(arrivals) / len(arrivals),
        "solve_ms": solve_ms,
    }


def timed(fn, *args, **kwargs):
    t0 = time.perf_counter()
    result = fn(*args, **kwargs)
    return result, (time.perf_counter() - t0) * 1000


def heuristics_job(job):
    dataset, hub, size, batch, idx = job
    dur, km, points = submatrices(dataset, hub, idx)
    opened = _open(dur)
    seed = stable_seed("alns", dataset, hub, size, batch)
    rows = []

    def add(algo, fn, *args, **kwargs):
        tour, ms = timed(fn, *args, **kwargs)
        rows.append(row(job, algo, tour, dur, km, ms))
        return tour, ms

    # Application-level status quo.
    drive, dist, arrivals = point_to_point(size, dur, km)
    rows.append(
        {
            "dataset": dataset,
            "hub": hub,
            "size": size,
            "batch": batch,
            "algo": "point_to_point",
            "drive_min": drive,
            "km": dist,
            "avg_wait_min": sum(arrivals) / len(arrivals),
            "solve_ms": 0.0,
        }
    )
    add("batch_fifo", lambda: list(range(1, size + 1)))
    # Textbook heuristics.
    nn, _ = add("nearest_neighbour", _nearest_next, size, dur)
    add("nn_2opt", lambda: tsp.two_opt(_nearest_next(size, dur), opened))
    # ALNS's own starting solution: anything beyond this is the ALNS layer's work.
    add("nn_2opt_oropt", lambda: tsp.local_search(_nearest_next(size, dur), opened))
    # The solver under test, and the same solver without adaptive operator weights.
    _, alns_ms = add("alns", run_alns, dur, points, seed)
    add("alns_uniform_ops", run_alns, dur, points, seed, reaction=0.0)
    # The standard library solver: first solution, then search.
    add("ortools_first", run_ortools, dur)
    add("ortools_gls_equal_time", run_ortools, dur, alns_ms)
    add("ortools_gls_2s", run_ortools, dur, ORTOOLS_LONG_MS)
    return rows


def exact_job(job, hint):
    dataset, hub, size, batch, idx = job
    dur, km, _ = submatrices(dataset, hub, idx)
    (tour, status, bound), ms = timed(run_exact, dur, hint)
    return {**row(job, "exact_cpsat", tour, dur, km, ms), "status": status, "bound_min": bound}


def robust_job(job):
    dataset, hub, size, batch, idx = job
    dur, km, points = submatrices(dataset, hub, idx)
    rows = []
    for seed in range(30):
        tour, ms = timed(run_alns, dur, points, seed)
        rows.append({**row(job, "alns", tour, dur, km, ms), "seed": seed})
    return rows


BUDGETS = (25, 50, 100, 150, 300, 600, 1200)


def budget_job(job):
    dataset, hub, size, batch, idx = job
    dur, km, points = submatrices(dataset, hub, idx)
    rows = []
    for budget in BUDGETS:
        # Without early stopping, so each budget is fully spent. "300 + stop" is
        # the production configuration.
        tour, ms = timed(
            run_alns, dur, points, stable_seed(batch, budget),
            max_iterations=budget, patience=budget,
        )
        rows.append({**row(job, "alns", tour, dur, km, ms), "budget": budget})
    tour, ms = timed(run_alns, dur, points, stable_seed(batch, "prod"))
    rows.append({**row(job, "alns", tour, dur, km, ms), "budget": "300+early_stop"})
    return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        raise ValueError(f"no rows for {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {len(rows)} rows to {path}", flush=True)


def stage_fetch() -> None:
    import requests

    rng = np.random.default_rng(stable_seed("holdout"))
    pools = {}

    def table(coords, annotations="duration,distance"):
        lnglat = ";".join(f"{lng:.6f},{lat:.6f}" for lat, lng in coords)
        response = requests.get(
            OSRM_TABLE + lnglat, params={"annotations": annotations}, timeout=60
        )
        response.raise_for_status()
        body = response.json()
        if body.get("code") != "Ok":
            raise RuntimeError(body.get("code"))
        return body

    for hub, (lat, lng) in HOLDOUT_HUBS.items():
        # Uniform over a disc, in rounds: points in Manila Bay or with no road
        # nearby are dropped because they snap too far away.
        snapped: list[tuple[float, float]] = []
        for _ in range(5):
            angle = rng.uniform(0, 2 * math.pi, 99)
            radius = HOLDOUT_RADIUS_KM * np.sqrt(rng.uniform(0, 1, 99))
            candidates = [
                (
                    lat + r * math.sin(a) / 110.574,
                    lng + r * math.cos(a) / (111.320 * math.cos(math.radians(lat))),
                )
                for r, a in zip(radius, angle, strict=True)
            ]
            sources = table([(lat, lng), *candidates], "duration")["sources"]
            snapped += [
                (s["location"][1], s["location"][0])
                for s in sources[1:]
                if s["distance"] <= MAX_SNAP_M
            ]
            time.sleep(1.5)  # public demo server
            if len(snapped) >= HOLDOUT_CUSTOMERS:
                break
        if len(snapped) < HOLDOUT_CUSTOMERS:
            raise RuntimeError(f"{hub}: only {len(snapped)} usable customers")
        points = [
            (sources[0]["location"][1], sources[0]["location"][0]),
            *snapped[:HOLDOUT_CUSTOMERS],
        ]
        body = table(points)
        if any(v is None for r in body["durations"] + body["distances"] for v in r):
            raise RuntimeError(f"{hub}: unroutable pair in matrix")
        pools[hub] = {
            "names": ["hub"] + [f"c{i}" for i in range(1, len(points))],
            "points": [list(p) for p in points],
            "distance_km": [[v / 1000 for v in r] for r in body["distances"]],
            "duration_min": [[v / 60 for v in r] for r in body["durations"]],
        }
        print(f"{hub}: {len(points) - 1} customers", flush=True)
        time.sleep(1.5)
    DATASETS["holdout"].write_text(json.dumps(pools))
    print(f"wrote {DATASETS['holdout']}")


def stage_heuristics(out: Path, workers: int) -> None:
    jobs = [j for d in DATASETS for j in instances(d)]
    rows = []
    with ProcessPoolExecutor(workers) as pool:
        for i, job_rows in enumerate(pool.map(heuristics_job, jobs, chunksize=4)):
            rows.extend(job_rows)
            if (i + 1) % 100 == 0:
                print(f"{i + 1}/{len(jobs)}", flush=True)
    write_csv(out / "heuristics.csv", rows)


def stage_exact(out: Path) -> None:
    # Warm-started from local search, so ALNS results cannot leak into the proof.
    rows = []
    jobs = [j for d in DATASETS for j in instances(d)]
    for i, job in enumerate(jobs):
        dur, _, _ = submatrices(job[0], job[1], job[4])
        hint = tsp.local_search(_nearest_next(job[2], dur), _open(dur))
        rows.append(exact_job(job, hint))
        if (i + 1) % 25 == 0:
            write_csv(out / "exact.csv", rows)
            print(f"{i + 1}/{len(jobs)}", flush=True)
    write_csv(out / "exact.csv", rows)


def stage_crosscheck(out: Path) -> None:
    rows = []
    for job in instances("holdout", sizes=(5, 10, 12), per_size=20):
        dataset, hub, size, batch, idx = job
        dur, _, _ = submatrices(dataset, hub, idx)
        hint = tsp.local_search(_nearest_next(size, dur), _open(dur))
        tour, status, _ = run_exact(dur, hint)
        rows.append(
            {
                "size": size,
                "hub": hub,
                "batch": batch,
                "status": status,
                "cpsat": _evaluate_path(tour, dur, dur)[0],
                "held_karp": held_karp(dur),
            }
        )
    write_csv(out / "crosscheck.csv", rows)


def stage_map(out: Path, name: str, fn, jobs, workers: int) -> None:
    rows = []
    with ProcessPoolExecutor(workers) as pool:
        for job_rows in pool.map(fn, jobs):
            rows.extend(job_rows)
    write_csv(out / name, rows)


def stage_timing(out: Path) -> None:
    """One solve at a time, so the clock is not sharing a machine with other runs."""
    rows = []
    jobs = list(instances("holdout", per_size=20))
    for job in jobs:
        dataset, hub, size, batch, idx = job
        dur, km, points = submatrices(dataset, hub, idx)
        seed = stable_seed("timing", dataset, hub, size, batch)
        for repeat in range(3):
            tour, ms = timed(run_alns, dur, points, seed + repeat)
            rows.append({**row(job, "alns", tour, dur, km, ms), "repeat": repeat})
    write_csv(out / "timing.csv", rows)


def stage_exact_single_core(out: Path) -> None:
    rows = []
    for job in instances("holdout", per_size=20):
        dataset, hub, size, batch, idx = job
        dur, km, _ = submatrices(dataset, hub, idx)
        hint = tsp.local_search(_nearest_next(size, dur), _open(dur))
        (tour, status, _), ms = timed(run_exact, dur, hint, workers=1)
        rows.append({**row(job, "exact_cpsat_1core", tour, dur, km, ms), "status": status})
    write_csv(out / "exact_single_core.csv", rows)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    parser.add_argument(
        "stage",
        choices=(
            "fetch",
            "heuristics",
            "exact",
            "crosscheck",
            "robust",
            "budget",
            "timing",
            "exact1",
        ),
    )
    parser.add_argument(
        "--out", type=Path, default=BACKEND_ROOT / "scripts" / "results" / "alns"
    )
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    if args.stage == "fetch":
        stage_fetch()
    elif args.stage == "heuristics":
        stage_heuristics(args.out, args.workers)
    elif args.stage == "exact":
        stage_exact(args.out)
    elif args.stage == "crosscheck":
        stage_crosscheck(args.out)
    elif args.stage == "robust":
        jobs = list(instances("holdout", per_size=20))
        stage_map(args.out, "robust.csv", robust_job, jobs, args.workers)
    elif args.stage == "budget":
        jobs = list(instances("holdout", sizes=(20, 40), per_size=40))
        stage_map(args.out, "budget.csv", budget_job, jobs, args.workers)
    elif args.stage == "timing":
        stage_timing(args.out)
    elif args.stage == "exact1":
        stage_exact_single_core(args.out)


if __name__ == "__main__":
    main()

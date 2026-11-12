"""
Tests for the custom ALNS routing module. Dont push this to main gyuys

"""

import itertools
import math
from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from app.routing import tsp
from app.routing.eta import _eta_from_waypoints
from app.routing.service import compute_route
from app.routing.solver import solve
from app.routing.state import Stop

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

DEPOT_LAT, DEPOT_LNG = 14.60, 121.00


def make_stop(order_id: int, lat: float, lng: float) -> Stop:
    return Stop(order_id=order_id, merchant_id=1, lat=lat, lng=lng)


def make_linear_stops(n: int) -> list[Stop]:
    """n stops in a straight line heading northeast from the depot."""
    return [
        make_stop(i, DEPOT_LAT + (i + 1) * 0.01, DEPOT_LNG + (i + 1) * 0.01)
        for i in range(n)
    ]


def _haversine_km(a: Stop, b: Stop) -> float:
    """Scalar great-circle distance, independent of the solver's matrix code."""
    lat_a, lng_a = math.radians(a.lat), math.radians(a.lng)
    lat_b, lng_b = math.radians(b.lat), math.radians(b.lng)
    h = (
        math.sin((lat_b - lat_a) / 2) ** 2
        + math.cos(lat_a) * math.cos(lat_b) * math.sin((lng_b - lng_a) / 2) ** 2
    )
    return 6371.0 * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


class TestEtaHelper:
    def test_uses_estimated_arrival_without_shipped_at(self):
        now = datetime.now(UTC)
        route_waypoints = [
            {"type": "pickup", "order_id": None, "total_duration_seconds": 600},
            {
                "type": "delivery",
                "order_id": 7,
                "estimated_arrival_at": (now + timedelta(minutes=8)).isoformat(),
                "duration_seconds": 600,
            },
        ]

        progress, eta_minutes = _eta_from_waypoints(None, route_waypoints, 7)

        assert eta_minutes == 8
        assert 0.0 <= progress <= 1.0


# ---------------------------------------------------------------------------
# Solver (end-to-end)
# ---------------------------------------------------------------------------


class TestSolve:
    def test_solve_returns_all_stops(self):
        stops = make_linear_stops(6)
        result = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=0)
        assert sorted(s.order_id for s in result.stops) == list(range(6))

    def test_solve_improves_on_shuffled_input(self):
        stops = make_linear_stops(8)
        dist = tsp.haversine_matrix(stops, DEPOT_LAT, DEPOT_LNG)
        shuffled = [1, 5, 2, 7, 3, 8, 4, 6]
        result = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=1)
        tour = [s.order_id + 1 for s in result.stops]
        assert tsp.tour_cost(tour, dist) < tsp.tour_cost(shuffled, dist)

    def test_solve_single_stop(self):
        stops = make_linear_stops(1)
        result = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=0)
        assert len(result.stops) == 1


# ---------------------------------------------------------------------------
# Service layer
# ---------------------------------------------------------------------------


class TestService:
    def test_compute_route_empty(self):
        assert compute_route([], DEPOT_LAT, DEPOT_LNG) == []

    def test_compute_route_single(self):
        stops = make_linear_stops(1)
        assert compute_route(stops, DEPOT_LAT, DEPOT_LNG) == stops

    def test_compute_route_returns_all_stops(self):
        stops = make_linear_stops(5)
        result = compute_route(stops, DEPOT_LAT, DEPOT_LNG)
        assert sorted(s.order_id for s in result) == list(range(5))


# ---------------------------------------------------------------------------
# Matrix ALNS (tsp.py)
# ---------------------------------------------------------------------------


def _random_stops(n: int, seed: int, spread: float = 0.08) -> list[Stop]:
    rng = np.random.default_rng(seed)
    return [
        make_stop(
            i,
            DEPOT_LAT + rng.uniform(-spread, spread),
            DEPOT_LNG + rng.uniform(-spread, spread),
        )
        for i in range(n)
    ]


def _brute_force_cost(dist: list[list[float]]) -> float:
    nodes = range(1, len(dist))
    return min(tsp.tour_cost(list(p), dist) for p in itertools.permutations(nodes))


class TestTsp:
    def test_matrix_matches_haversine(self):
        stops = _random_stops(5, 0)
        dist = tsp.haversine_matrix(stops, DEPOT_LAT, DEPOT_LNG)
        depot = Stop(order_id=-1, merchant_id=-1, lat=DEPOT_LAT, lng=DEPOT_LNG)
        points = [depot] + stops
        for i, a in enumerate(points):
            for j, b in enumerate(points):
                assert abs(dist[i][j] - _haversine_km(a, b)) < 1e-9

    def test_solve_tour_is_optimal_on_small_instances(self):
        for seed in range(8):
            dist = tsp.haversine_matrix(_random_stops(7, seed), DEPOT_LAT, DEPOT_LNG)
            tour = tsp.solve_tour(dist, np.random.default_rng(seed))
            assert sorted(tour) == list(range(1, 8))
            assert tsp.tour_cost(tour, dist) <= _brute_force_cost(dist) + 1e-9

    def test_local_search_never_lengthens_tour(self):
        rng = np.random.default_rng(1)
        dist = tsp.haversine_matrix(_random_stops(25, 1), DEPOT_LAT, DEPOT_LNG)
        for _ in range(10):
            tour = [int(x) for x in rng.permutation(np.arange(1, 26))]
            improved = tsp.local_search(tour, dist)
            assert sorted(improved) == sorted(tour)
            assert tsp.tour_cost(improved, dist) <= tsp.tour_cost(tour, dist) + 1e-9

    def test_destroy_and_repair_keep_every_stop(self):
        rng = np.random.default_rng(2)
        dist = tsp.haversine_matrix(_random_stops(20, 2), DEPOT_LAT, DEPOT_LNG)
        neighbours = [
            sorted((y for y in range(1, 21) if y != x), key=dist[x].__getitem__)
            for x in range(21)
        ]
        tour = list(range(1, 21))
        for destroy in tsp._DESTROY_OPS:
            for repair in tsp._REPAIR_OPS:
                partial, removed = destroy(tour, dist, neighbours, 8, rng)
                assert removed and sorted(partial + removed) == tour
                assert sorted(repair(partial, removed, dist, rng)) == tour

    def test_regret2_incremental_costs_match_full_recompute(self):
        rng = np.random.default_rng(3)
        dist = tsp.haversine_matrix(_random_stops(15, 3), DEPOT_LAT, DEPOT_LNG)
        partial, removed = list(range(1, 9)), list(range(9, 16))
        tour = tsp.regret2_insert(partial, removed, dist, rng)
        # Rebuild with a naive regret-2 that recomputes every cost each step.
        naive, pending = list(partial), list(removed)
        while pending:
            best = None
            for j, node in enumerate(pending):
                c = sorted(tsp._insertion_costs(naive, node, dist))
                key = (c[1] - c[0], -c[0])
                if best is None or key > best[0]:
                    best = (key, j)
            node = pending.pop(best[1])
            costs = tsp._insertion_costs(naive, node, dist)
            naive.insert(costs.index(min(costs)), node)
        assert tour == naive

    def test_open_path_never_longer_than_closed_tour_path(self):
        for seed in range(5):
            stops = _random_stops(15, seed)
            closed = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=0)
            opened = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=0, return_to_depot=False)

            def path_km(route: list[Stop]) -> float:
                depot = Stop(order_id=-1, merchant_id=-1, lat=DEPOT_LAT, lng=DEPOT_LNG)
                pts = [depot] + route
                return sum(
                    _haversine_km(pts[i], pts[i + 1]) for i in range(len(pts) - 1)
                )

            assert path_km(opened.stops) <= path_km(closed.stops) + 1e-9

    def test_solve_is_deterministic_for_a_seed(self):
        stops = _random_stops(20, 4)
        a = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=7)
        b = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=7)
        assert [s.order_id for s in a.stops] == [s.order_id for s in b.stops]

    def test_solve_tiny_routes(self):
        for n in (0, 1, 2, 3):
            stops = _random_stops(n, n)
            result = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=0)
            assert sorted(s.order_id for s in result.stops) == list(range(n))


def _asymmetric_matrix(n: int, seed: int) -> list[list[float]]:
    """Haversine distances with up to ±40% per-direction noise (one-way streets)."""
    dist = tsp.haversine_matrix(_random_stops(n, seed), DEPOT_LAT, DEPOT_LNG)
    rng = np.random.default_rng(seed)
    return [
        [0.0 if i == j else d * rng.uniform(0.6, 1.4) for j, d in enumerate(row)]
        for i, row in enumerate(dist)
    ]


class TestTspAsymmetric:
    def test_local_search_never_lengthens_asymmetric_tour(self):
        rng = np.random.default_rng(5)
        for seed in range(5):
            dist = _asymmetric_matrix(20, seed)
            for _ in range(10):
                tour = [int(x) for x in rng.permutation(np.arange(1, 21))]
                improved = tsp.local_search(tour, dist)
                assert sorted(improved) == sorted(tour)
                assert tsp.tour_cost(improved, dist) <= tsp.tour_cost(tour, dist) + 1e-9

    def test_solve_tour_is_optimal_on_small_asymmetric_instances(self):
        for seed in range(8):
            dist = _asymmetric_matrix(7, seed)
            tour = tsp.solve_tour(dist, np.random.default_rng(seed))
            assert tsp.tour_cost(tour, dist) <= _brute_force_cost(dist) + 1e-9

    def test_solve_uses_supplied_distance_matrix(self):
        # Make the straight-line-best order expensive: travelling "up" the
        # line costs 10x, so with return_to_depot=False the solver should
        # visit the far stop first and come back down.
        stops = make_linear_stops(4)
        n = len(stops) + 1
        matrix = [[0.0] * n for _ in range(n)]
        for i in range(n):
            for j in range(n):
                if i != j:
                    matrix[i][j] = abs(i - j) * (10.0 if j > i and i > 0 else 1.0)
        result = solve(
            stops,
            DEPOT_LAT,
            DEPOT_LNG,
            seed=0,
            return_to_depot=False,
            distance_matrix=matrix,
        )
        assert [s.order_id for s in result.stops] == [3, 2, 1, 0]

    def test_solve_rejects_wrong_matrix_shape(self):
        stops = make_linear_stops(3)
        with pytest.raises(ValueError):
            solve(stops, DEPOT_LAT, DEPOT_LNG, distance_matrix=[[0.0] * 3] * 3)

    def test_solve_handles_all_stops_at_pickup_point(self):
        # Every leg costs 0 (all orders geocode to the merchant's location):
        # used to divide by a zero annealing temperature.
        stops = [make_stop(i, DEPOT_LAT, DEPOT_LNG) for i in range(5)]
        for return_to_depot in (True, False):
            result = solve(
                stops, DEPOT_LAT, DEPOT_LNG, seed=0, return_to_depot=return_to_depot
            )
            assert sorted(s.order_id for s in result.stops) == list(range(5))

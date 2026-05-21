"""
Tests for the custom ALNS routing module.

Convention: stops are placed on a simple lat/lng grid so expected distances
and orderings are predictable without floating-point surprises.
"""

import pytest
import numpy as np

from app.routing.state import Stop, RouteState, MultiRouteState, _haversine_distance
from app.routing.operators.destroy import (
    random_removal,
    worst_removal,
    knearest_removal,
    cross_route_removal,
    random_removal_multi,
)
from app.routing.operators.repair import (
    greedy_insert,
    random_insert,
    regret2_insert,
    cross_route_insert,
    greedy_insert_multi,
    _best_insertion,
)
from app.routing.solver import solve, solve_multi, _two_opt
from app.routing.service import compute_route, compute_routes


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

DEPOT_LAT, DEPOT_LNG = 14.60, 121.00

def make_stop(order_id: int, lat: float, lng: float) -> Stop:
    return Stop(order_id=order_id, merchant_id=1, lat=lat, lng=lng)


def make_linear_stops(n: int) -> list[Stop]:
    """n stops in a straight line heading northeast from the depot."""
    return [make_stop(i, DEPOT_LAT + (i + 1) * 0.01, DEPOT_LNG + (i + 1) * 0.01) for i in range(n)]


def make_state(stops: list[Stop]) -> RouteState:
    return RouteState(depot_lat=DEPOT_LAT, depot_lng=DEPOT_LNG, stops=list(stops))


def make_multi_state(routes: list[list[Stop]]) -> MultiRouteState:
    return MultiRouteState(
        routes=[RouteState(depot_lat=DEPOT_LAT, depot_lng=DEPOT_LNG, stops=list(s)) for s in routes]
    )


# ---------------------------------------------------------------------------
# State / objective
# ---------------------------------------------------------------------------

class TestRouteState:
    def test_objective_empty_no_unassigned(self):
        state = make_state([])
        assert state.objective() == 0.0

    def test_objective_empty_with_unassigned(self):
        state = make_state([])
        state.unassigned = make_linear_stops(2)
        assert state.objective() == float("inf")

    def test_objective_penalises_unassigned(self):
        stops = make_linear_stops(3)
        state = make_state(stops)
        base = state.objective()

        state2 = state.copy()
        state2.unassigned.append(state2.stops.pop())
        assert state2.objective() > base + 999_000

    def test_copy_is_independent(self):
        stops = make_linear_stops(3)
        state = make_state(stops)
        clone = state.copy()
        clone.stops.pop()
        assert len(state.stops) == 3


class TestMultiRouteState:
    def test_objective_sums_routes(self):
        stops = make_linear_stops(4)
        multi = make_multi_state([stops[:2], stops[2:]])
        r1 = make_state(stops[:2]).objective()
        r2 = make_state(stops[2:]).objective()
        assert abs(multi.objective() - (r1 + r2)) < 1e-6

    def test_objective_penalises_unassigned(self):
        multi = make_multi_state([make_linear_stops(2), []])
        base = multi.objective()
        multi.unassigned.append(make_stop(99, 14.65, 121.05))
        assert multi.objective() > base + 999_000


# ---------------------------------------------------------------------------
# Destroy operators — single route
# ---------------------------------------------------------------------------

def _all_stops_accounted(original: RouteState, result: RouteState) -> bool:
    orig_ids = sorted(s.order_id for s in original.stops)
    new_ids = sorted(s.order_id for s in result.stops + result.unassigned)
    return orig_ids == new_ids


class TestDestroyOperators:
    rng = np.random.default_rng(42)

    def test_random_removal_count(self):
        state = make_state(make_linear_stops(10))
        result = random_removal(state, self.rng)
        assert 1 <= len(result.unassigned) <= 3  # 10–30% of 10
        assert _all_stops_accounted(state, result)

    def test_worst_removal_count(self):
        state = make_state(make_linear_stops(10))
        result = worst_removal(state, self.rng)
        assert 1 <= len(result.unassigned) <= 3
        assert _all_stops_accounted(state, result)

    def test_knearest_removal_count(self):
        state = make_state(make_linear_stops(10))
        result = knearest_removal(state, self.rng)
        assert 1 <= len(result.unassigned) <= 3
        assert _all_stops_accounted(state, result)

    def test_knearest_removes_geographically_close_stops(self):
        # Cluster of 3 close stops + 1 far stop
        close = [make_stop(i, 14.601 + i * 0.001, 121.001) for i in range(3)]
        far   = [make_stop(10, 15.5, 122.0)]
        state = make_state(close + far)
        rng = np.random.default_rng(0)
        # Force pivot to a close stop by running several times; far stop should survive
        removed_far = 0
        for _ in range(20):
            result = knearest_removal(state, rng)
            if any(s.order_id == 10 for s in result.unassigned):
                removed_far += 1
        # Far stop should rarely be removed (only if pivot happens to be far stop)
        assert removed_far < 10

    def test_operators_never_mutate_input(self):
        state = make_state(make_linear_stops(6))
        original_ids = [s.order_id for s in state.stops]
        rng = np.random.default_rng(7)
        random_removal(state, rng)
        worst_removal(state, rng)
        knearest_removal(state, rng)
        assert [s.order_id for s in state.stops] == original_ids

    def test_empty_route_returns_unchanged(self):
        state = make_state([])
        rng = np.random.default_rng(0)
        assert random_removal(state, rng).stops == []
        assert worst_removal(state, rng).stops == []
        assert knearest_removal(state, rng).stops == []


# ---------------------------------------------------------------------------
# Destroy operators — multi route
# ---------------------------------------------------------------------------

class TestDestroyMulti:
    def test_cross_route_removal_accounts_for_all_stops(self):
        stops = make_linear_stops(8)
        multi = make_multi_state([stops[:4], stops[4:]])
        rng = np.random.default_rng(1)
        result = cross_route_removal(multi, rng)
        all_before = {s.order_id for s in stops}
        all_after = {s.order_id for r in result.routes for s in r.stops} | {s.order_id for s in result.unassigned}
        assert all_before == all_after

    def test_random_removal_multi_accounts_for_all_stops(self):
        stops = make_linear_stops(8)
        multi = make_multi_state([stops[:4], stops[4:]])
        rng = np.random.default_rng(2)
        result = random_removal_multi(multi, rng)
        all_before = {s.order_id for s in stops}
        all_after = {s.order_id for r in result.routes for s in r.stops} | {s.order_id for s in result.unassigned}
        assert all_before == all_after


# ---------------------------------------------------------------------------
# Repair operators — single route
# ---------------------------------------------------------------------------

def _repair_reinserts_all(op, n: int = 5) -> bool:
    stops = make_linear_stops(n)
    state = make_state([])
    state.unassigned = list(stops)
    rng = np.random.default_rng(42)
    result = op(state, rng)
    return len(result.stops) == n and len(result.unassigned) == 0


class TestRepairOperators:
    def test_greedy_insert_reinserts_all(self):
        assert _repair_reinserts_all(greedy_insert)

    def test_random_insert_reinserts_all(self):
        assert _repair_reinserts_all(random_insert)

    def test_regret2_insert_reinserts_all(self):
        assert _repair_reinserts_all(regret2_insert)

    def test_greedy_insert_better_than_random_on_average(self):
        """Greedy should produce shorter routes than random on average."""
        stops = make_linear_stops(8)
        rng_g = np.random.default_rng(0)
        rng_r = np.random.default_rng(0)
        greedy_objs, random_objs = [], []
        for _ in range(30):
            state = make_state([])
            state.unassigned = list(stops)
            greedy_objs.append(greedy_insert(state, rng_g).objective())
            state2 = make_state([])
            state2.unassigned = list(stops)
            random_objs.append(random_insert(state2, rng_r).objective())
        assert sum(greedy_objs) <= sum(random_objs)

    def test_regret2_does_not_worsen_vs_greedy_on_average(self):
        stops = make_linear_stops(8)
        rng_r2 = np.random.default_rng(5)
        rng_g  = np.random.default_rng(5)
        r2_objs, g_objs = [], []
        for _ in range(30):
            state = make_state([])
            state.unassigned = list(stops)
            r2_objs.append(regret2_insert(state, rng_r2).objective())
            state2 = make_state([])
            state2.unassigned = list(stops)
            g_objs.append(greedy_insert(state2, rng_g).objective())
        # Regret-2 should be at least as good as greedy on average
        assert sum(r2_objs) <= sum(g_objs) * 1.05  # 5% tolerance

    def test_operators_never_mutate_input(self):
        stops = make_linear_stops(4)
        state = make_state([])
        state.unassigned = list(stops)
        original_unassigned = list(state.unassigned)
        rng = np.random.default_rng(9)
        greedy_insert(state, rng)
        assert [s.order_id for s in state.unassigned] == [s.order_id for s in original_unassigned]


# ---------------------------------------------------------------------------
# Repair operators — multi route
# ---------------------------------------------------------------------------

class TestRepairMulti:
    def _make_state_with_unassigned(self, n_routes: int, n_unassigned: int) -> MultiRouteState:
        multi = make_multi_state([[] for _ in range(n_routes)])
        multi.unassigned = make_linear_stops(n_unassigned)
        return multi

    def test_cross_route_insert_reinserts_all(self):
        multi = self._make_state_with_unassigned(2, 6)
        rng = np.random.default_rng(0)
        result = cross_route_insert(multi, rng)
        assert len(result.unassigned) == 0
        assert sum(len(r.stops) for r in result.routes) == 6

    def test_greedy_insert_multi_reinserts_all(self):
        multi = self._make_state_with_unassigned(2, 6)
        rng = np.random.default_rng(0)
        result = greedy_insert_multi(multi, rng)
        assert len(result.unassigned) == 0
        assert sum(len(r.stops) for r in result.routes) == 6

    def test_greedy_insert_multi_distributes_across_routes(self):
        """Route-driven operator should spread stops across both routes."""
        multi = self._make_state_with_unassigned(2, 6)
        rng = np.random.default_rng(0)
        result = greedy_insert_multi(multi, rng)
        sizes = [len(r.stops) for r in result.routes]
        assert all(s > 0 for s in sizes), f"some route is empty: {sizes}"


# ---------------------------------------------------------------------------
# 2-opt
# ---------------------------------------------------------------------------

class TestTwoOpt:
    def test_two_opt_improves_known_crossing_route(self):
        # Deliberately zigzag: 0→3→1→2→0 crosses; 0→1→2→3→0 is optimal.
        depot = Stop(order_id=-1, merchant_id=-1, lat=DEPOT_LAT, lng=DEPOT_LNG)
        s0 = make_stop(0, 14.61, 121.01)
        s1 = make_stop(1, 14.62, 121.02)
        s2 = make_stop(2, 14.63, 121.03)
        s3 = make_stop(3, 14.64, 121.04)
        bad_order = [s0, s3, s1, s2]
        good_order = [s0, s1, s2, s3]

        def route_dist(stops):
            r = [depot] + stops + [depot]
            return sum(_haversine_distance(r[i], r[i+1]) for i in range(len(r)-1))

        improved = _two_opt(bad_order, depot)
        assert route_dist(improved) <= route_dist(bad_order)
        assert route_dist(improved) <= route_dist(good_order) + 1e-6

    def test_two_opt_does_not_lose_stops(self):
        stops = make_linear_stops(6)
        depot = Stop(order_id=-1, merchant_id=-1, lat=DEPOT_LAT, lng=DEPOT_LNG)
        result = _two_opt(stops, depot)
        assert sorted(s.order_id for s in result) == sorted(s.order_id for s in stops)

    def test_two_opt_trivial_routes(self):
        depot = Stop(order_id=-1, merchant_id=-1, lat=DEPOT_LAT, lng=DEPOT_LNG)
        assert _two_opt([], depot) == []
        one = make_linear_stops(1)
        assert len(_two_opt(one, depot)) == 1


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
        # Reversed order is a bad starting point
        shuffled = RouteState(depot_lat=DEPOT_LAT, depot_lng=DEPOT_LNG, stops=list(reversed(stops)))
        result = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=1)
        assert result.objective() <= shuffled.objective() + 1e-6

    def test_solve_single_stop(self):
        stops = make_linear_stops(1)
        result = solve(stops, DEPOT_LAT, DEPOT_LNG, seed=0)
        assert len(result.stops) == 1


class TestSolveMulti:
    def test_solve_multi_covers_all_stops(self):
        stops = make_linear_stops(8)
        result = solve_multi(stops, DEPOT_LAT, DEPOT_LNG, n_vehicles=2, seed=0)
        all_ids = sorted(s.order_id for r in result.routes for s in r.stops)
        assert all_ids == list(range(8))

    def test_solve_multi_returns_correct_vehicle_count(self):
        stops = make_linear_stops(6)
        result = solve_multi(stops, DEPOT_LAT, DEPOT_LNG, n_vehicles=3, seed=0)
        assert len(result.routes) == 3

    def test_solve_multi_no_stop_duplication(self):
        stops = make_linear_stops(6)
        result = solve_multi(stops, DEPOT_LAT, DEPOT_LNG, n_vehicles=2, seed=2)
        all_ids = [s.order_id for r in result.routes for s in r.stops]
        assert len(all_ids) == len(set(all_ids))


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

    def test_compute_routes_empty(self):
        result = compute_routes([], DEPOT_LAT, DEPOT_LNG, n_vehicles=2)
        assert result == [[], []]

    def test_compute_routes_fewer_stops_than_vehicles(self):
        stops = make_linear_stops(2)
        result = compute_routes(stops, DEPOT_LAT, DEPOT_LNG, n_vehicles=3)
        assert len(result) == 3
        all_ids = [s.order_id for r in result for s in r]
        assert sorted(all_ids) == list(range(2))

    def test_compute_routes_single_vehicle_matches_compute_route(self):
        stops = make_linear_stops(5)
        single = compute_routes(stops, DEPOT_LAT, DEPOT_LNG, n_vehicles=1)[0]
        direct = compute_route(stops, DEPOT_LAT, DEPOT_LNG)
        assert sorted(s.order_id for s in single) == sorted(s.order_id for s in direct)

    def test_compute_routes_covers_all_stops(self):
        stops = make_linear_stops(8)
        result = compute_routes(stops, DEPOT_LAT, DEPOT_LNG, n_vehicles=2)
        all_ids = sorted(s.order_id for r in result for s in r)
        assert all_ids == list(range(8))

"""
Single-vehicle ALNS on a precomputed distance matrix.

Tours are lists of node indices; node 0 is the depot and node i (1..N) is
stops[i - 1]. Working on indices and a list-of-lists matrix instead of Stop
objects makes every distance lookup O(1), which is what lets the solver run
local search on every candidate (the single biggest quality win).
"""

import math
from collections.abc import Callable

import numpy as np

from app.routing.state import Stop

Matrix = list[list[float]]
Tour = list[int]

_SCORE_BEST = 10.0
_SCORE_IMPROVE = 5.0
_SCORE_ACCEPT = 2.0
_EPS = 1e-9


# ---------------------------------------------------------------------------
# Distances
# ---------------------------------------------------------------------------


def haversine_matrix(stops: list[Stop], depot_lat: float, depot_lng: float) -> Matrix:
    """Pairwise great-circle distances in km, depot at index 0."""
    lat = np.radians([depot_lat] + [s.lat for s in stops])
    lng = np.radians([depot_lng] + [s.lng for s in stops])
    dlat = lat[:, None] - lat[None, :]
    dlng = lng[:, None] - lng[None, :]
    a = (
        np.sin(dlat / 2) ** 2
        + np.cos(lat)[:, None] * np.cos(lat)[None, :] * np.sin(dlng / 2) ** 2
    )
    return (6371.0 * 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))).tolist()


def tour_cost(tour: Tour, dist: Matrix) -> float:
    prev, total = 0, 0.0
    for node in tour:
        total += dist[prev][node]
        prev = node
    return total + dist[prev][0]


# ---------------------------------------------------------------------------
# Local search
# ---------------------------------------------------------------------------


def two_opt(tour: Tour, dist: Matrix) -> Tour:
    """
    Reverse sub-sequences while that shortens the tour (first improvement).

    Works on asymmetric matrices (road distances, one-way streets): `rev`
    tracks how much the edges inside route[i..j] change when they are
    traversed backwards. It is always 0 for a symmetric matrix.
    """
    route = [0] + tour + [0]
    n = len(route)
    improved = True
    while improved:
        improved = False
        for i in range(1, n - 2):
            a, b = route[i - 1], route[i]
            dist_a = dist[a]
            d_ab = dist_a[b]
            rev = 0.0
            for j in range(i + 1, n - 1):
                c, d = route[j], route[j + 1]
                prev_c = route[j - 1]
                rev += dist[c][prev_c] - dist[prev_c][c]
                if dist_a[c] + dist[b][d] + rev < d_ab + dist[c][d] - 1e-10:
                    route[i : j + 1] = route[i : j + 1][::-1]
                    b = route[i]
                    d_ab = dist_a[b]
                    # The segment now runs the other way, so flip its sign.
                    rev = -rev
                    improved = True
    return route[1:-1]


def or_opt(tour: Tour, dist: Matrix) -> tuple[Tour, bool]:
    """
    Move a segment of 1–3 consecutive stops (optionally reversed) to its
    cheapest position. Returns (tour, improved).
    """
    route = [0] + tour + [0]
    improved = False
    for seg_len in (1, 2, 3):
        i = 1
        while i + seg_len < len(route):
            first, last = route[i], route[i + seg_len - 1]
            prev, nxt = route[i - 1], route[i + seg_len]
            gain = dist[prev][first] + dist[last][nxt] - dist[prev][nxt]
            # Extra cost of walking the segment backwards (0 if symmetric).
            seg_rev = sum(
                dist[route[k + 1]][route[k]] - dist[route[k]][route[k + 1]]
                for k in range(i, i + seg_len - 1)
            )
            rest = route[:i] + route[i + seg_len :]
            best_delta, best_move = -1e-10, None
            for j in range(len(rest) - 1):
                u, v = rest[j], rest[j + 1]
                d_uv = dist[u][v]
                forward = dist[u][first] + dist[last][v] - d_uv - gain
                if forward < best_delta:
                    best_delta, best_move = forward, (j, False)
                if seg_len > 1:
                    backward = dist[u][last] + dist[first][v] - d_uv - gain + seg_rev
                    if backward < best_delta:
                        best_delta, best_move = backward, (j, True)
            if best_move is None:
                i += 1
                continue
            j, reverse = best_move
            segment = route[i : i + seg_len]
            if reverse:
                segment.reverse()
            route = rest[: j + 1] + segment + rest[j + 1 :]
            improved = True
    return route[1:-1], improved


def local_search(tour: Tour, dist: Matrix) -> Tour:
    """Alternate 2-opt and or-opt until neither improves the tour."""
    tour = two_opt(tour, dist)
    while True:
        tour, improved = or_opt(tour, dist)
        if not improved:
            return tour
        tour = two_opt(tour, dist)


# ---------------------------------------------------------------------------
# Destroy operators: (tour, dist, neighbours, n_remove, rng) -> (partial, removed)
# ---------------------------------------------------------------------------


def _split(tour: Tour, remove: set[int]) -> tuple[Tour, Tour]:
    return [x for x in tour if x not in remove], [x for x in tour if x in remove]


def random_removal(tour, dist, neighbours, n_remove, rng):
    picked = rng.choice(len(tour), n_remove, replace=False)
    return _split(tour, {tour[i] for i in picked})


def worst_removal(tour, dist, neighbours, n_remove, rng):
    """Remove the stops whose detour costs the most (with ±20% noise)."""
    route = [0] + tour + [0]
    detour = [
        (
            dist[route[i - 1]][route[i]]
            + dist[route[i]][route[i + 1]]
            - dist[route[i - 1]][route[i + 1]]
        )
        * rng.uniform(0.8, 1.2)
        for i in range(1, len(route) - 1)
    ]
    worst = np.argsort(detour)[-n_remove:]
    return _split(tour, {tour[i] for i in worst})


def related_removal(tour, dist, neighbours, n_remove, rng):
    """Remove a random pivot and its n_remove - 1 nearest stops."""
    pivot = tour[int(rng.integers(len(tour)))]
    return _split(tour, {pivot, *neighbours[pivot][: n_remove - 1]})


def string_removal(tour, dist, neighbours, n_remove, rng):
    """
    Remove 1–3 contiguous strings of the tour around stops near a pivot
    (SISR-style). Frees whole route sections so they can be rebuilt in a
    different order, which single-stop moves cannot do.
    """
    position = {node: i for i, node in enumerate(tour)}
    n_strings = int(rng.integers(1, 4))
    length = max(1, n_remove // n_strings)
    remove: set[int] = set()
    pivot = tour[int(rng.integers(len(tour)))]
    for anchor in [pivot] + neighbours[pivot]:
        if n_strings == 0 or len(remove) >= n_remove:
            break
        if anchor in remove:
            continue
        start = position[anchor] - int(rng.integers(length))
        start = max(0, min(len(tour) - length, start))
        remove.update(tour[start : start + length])
        n_strings -= 1
    return _split(tour, remove)


# ---------------------------------------------------------------------------
# Repair operators: (partial, removed, dist, rng) -> tour
# ---------------------------------------------------------------------------


def _insertion_costs(tour: Tour, node: int, dist: Matrix) -> list[float]:
    """Cost of inserting node before position i, for i in 0..len(tour)."""
    to_node = dist[node]
    costs = []
    prev = 0
    for nxt in tour:
        costs.append(dist[prev][node] + to_node[nxt] - dist[prev][nxt])
        prev = nxt
    costs.append(dist[prev][node] + to_node[0] - dist[prev][0])
    return costs


def greedy_insert(partial, removed, dist, rng):
    """
    Insert stops one at a time at their cheapest position. The insertion
    order is random, farthest-first or nearest-first; 1% of the time the
    second-best slot is used instead ("blinks") to keep the search moving.
    """
    tour = list(partial)
    order = list(removed)
    mode = int(rng.integers(3))
    if mode == 0:
        rng.shuffle(order)
    else:
        order.sort(key=lambda x: dist[0][x], reverse=mode == 1)
    for node in order:
        costs = _insertion_costs(tour, node, dist)
        if len(costs) > 1 and rng.random() < 0.01:
            pos = int(np.argsort(costs)[1])
        else:
            pos = costs.index(min(costs))
        tour.insert(pos, node)
    return tour


def regret2_insert(partial, removed, dist, rng):
    """
    Insert first the stop with the largest gap between its best and
    second-best slot. Insertion costs are updated incrementally: placing a
    stop only changes the two slots next to it.
    """
    tour = list(partial)
    pending = list(removed)
    costs = [_insertion_costs(tour, node, dist) for node in pending]
    while pending:
        best_key, best_j, best_pos = None, 0, 0
        for j, c in enumerate(costs):
            c1 = min(c)
            pos = c.index(c1)
            if len(c) > 1:
                c[pos] = math.inf
                c2 = min(c)
                c[pos] = c1
            else:
                c2 = c1
            # Highest regret wins; ties go to the cheaper insertion.
            key = (c2 - c1, -c1)
            if best_key is None or key > best_key:
                best_key, best_j, best_pos = key, j, pos

        node = pending.pop(best_j)
        costs.pop(best_j)
        before = tour[best_pos - 1] if best_pos > 0 else 0
        after = tour[best_pos] if best_pos < len(tour) else 0
        tour.insert(best_pos, node)
        d_before_node = dist[before][node]
        d_node_after = dist[node][after]
        for other, c in zip(pending, costs, strict=True):
            c[best_pos] = dist[before][other] + dist[other][node] - d_before_node
            c.insert(
                best_pos + 1, dist[node][other] + dist[other][after] - d_node_after
            )
    return tour


_DESTROY_OPS: list[Callable] = [
    random_removal,
    worst_removal,
    related_removal,
    string_removal,
]
_REPAIR_OPS: list[Callable] = [greedy_insert, regret2_insert]


# ---------------------------------------------------------------------------
# Solver
# ---------------------------------------------------------------------------


def _roulette(weights: list[float], rng: np.random.Generator) -> int:
    pick = rng.random() * sum(weights)
    for i, w in enumerate(weights):
        pick -= w
        if pick <= 0:
            return i
    return len(weights) - 1


def _nearest_neighbour(dist: Matrix) -> Tour:
    left = set(range(1, len(dist)))
    tour, current = [], 0
    while left:
        current = min(left, key=dist[current].__getitem__)
        tour.append(current)
        left.remove(current)
    return tour


def solve_tour(
    dist: Matrix,
    rng: np.random.Generator,
    max_iterations: int = 300,
    patience: int = 150,
    min_removal: float = 0.3,
    max_removal: float = 0.8,
    segment_size: int = 50,
    reaction: float = 0.2,
) -> Tour:
    """
    ALNS + simulated annealing where every repaired candidate is polished
    with local search before acceptance.

    Large removals (30–80% of the tour) were needed to escape the deep local
    optima that 2-opt/or-opt leave behind; smaller ones stalled at 1–3% above
    the best-known length on some 30–40 stop instances. Stops early after
    `patience` iterations without a new best.
    """
    n = len(dist) - 1
    if n <= 3:
        # Local search is exact at this size.
        return local_search(list(range(1, n + 1)), dist)

    neighbours = [
        sorted((y for y in range(1, n + 1) if y != x), key=dist[x].__getitem__)
        for x in range(n + 1)
    ]

    current = local_search(_nearest_neighbour(dist), dist)
    current_cost = tour_cost(current, dist)
    best, best_cost = current, current_cost
    if current_cost <= 0:
        # Every leg is free (e.g. all orders geocode to the pickup point): any
        # order is optimal, and the annealing temperature below would be 0.
        return best

    avg_leg = current_cost / (n + 1)
    temp = 2.0 * avg_leg
    end_temp = 0.01 * avg_leg
    cooling = (end_temp / temp) ** (1.0 / max(1, max_iterations - 1))

    d_weights = [1.0] * len(_DESTROY_OPS)
    r_weights = [1.0] * len(_REPAIR_OPS)
    d_scores = [[0.0, 0] for _ in _DESTROY_OPS]
    r_scores = [[0.0, 0] for _ in _REPAIR_OPS]
    last_best = 0

    for i in range(max_iterations):
        if i - last_best > patience:
            break

        d_idx = _roulette(d_weights, rng)
        r_idx = _roulette(r_weights, rng)
        n_remove = int(round(n * rng.uniform(min_removal, max_removal)))
        n_remove = max(1, min(n - 1, n_remove))

        partial, removed = _DESTROY_OPS[d_idx](current, dist, neighbours, n_remove, rng)
        candidate = local_search(_REPAIR_OPS[r_idx](partial, removed, dist, rng), dist)
        candidate_cost = tour_cost(candidate, dist)

        delta = candidate_cost - current_cost
        score = 0.0
        if delta < -_EPS or rng.random() < math.exp(-max(delta, 0.0) / temp):
            current, current_cost = candidate, candidate_cost
            if candidate_cost < best_cost - _EPS:
                best, best_cost = candidate, candidate_cost
                last_best = i
                score = _SCORE_BEST
            elif delta < -_EPS:
                score = _SCORE_IMPROVE
            else:
                score = _SCORE_ACCEPT

        d_scores[d_idx][0] += score
        d_scores[d_idx][1] += 1
        r_scores[r_idx][0] += score
        r_scores[r_idx][1] += 1

        # Re-weight operators by their average score over the last segment.
        if (i + 1) % segment_size == 0:
            for weights, scores in ((d_weights, d_scores), (r_weights, r_scores)):
                for k, (total, count) in enumerate(scores):
                    if count:
                        weights[k] = max(
                            0.05, (1 - reaction) * weights[k] + reaction * total / count
                        )
                    scores[k] = [0.0, 0]

        temp *= cooling

    return best

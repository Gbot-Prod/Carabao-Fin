import numpy as np

from app.routing.state import RouteState, Stop
from app.routing.tsp import haversine_matrix, solve_tour


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

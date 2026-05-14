import numpy as np
from alns import ALNS
from alns.accept import SimulatedAnnealing
from alns.select import RandomSelect
from alns.stop import MaxIterations

from app.routing.state import RouteState, Stop
from app.routing.operators.destroy import random_removal, worst_removal
from app.routing.operators.repair import greedy_insert, random_insert


def _nearest_neighbour_initial(
    stops: list[Stop],
    depot_lat: float,
    depot_lng: float,
) -> list[Stop]:
    """
    Simple nearest-neighbour tour from the depot.

    Provides a materially better starting point than "input order", and keeps
    ALNS from spending iterations just undoing a poor initial permutation.
    """
    if len(stops) <= 1:
        return list(stops)

    remaining = list(stops)
    ordered: list[Stop] = []

    current = Stop(order_id=-1, merchant_id=-1, lat=depot_lat, lng=depot_lng)
    while remaining:
        # Import locally to avoid circular import at module load time.
        from app.routing.state import _haversine_distance

        next_idx = int(
            np.argmin([_haversine_distance(current, s) for s in remaining])
        )
        nxt = remaining.pop(next_idx)
        ordered.append(nxt)
        current = nxt

    return ordered


def solve(
    stops: list[Stop],
    depot_lat: float,
    depot_lng: float,
    seed: int | None = None,
    max_iterations: int = 1_000,
) -> RouteState:
    """
    Build an initial solution and run ALNS.

    Returns the best RouteState found.
    
    Args:
        stops: List of delivery stops
        depot_lat: Depot latitude
        depot_lng: Depot longitude
        seed: Random seed (None = use OS entropy for true randomness)
        max_iterations: Maximum ALNS iterations
    """
    rng = np.random.default_rng(seed)

    initial = RouteState(
        depot_lat=depot_lat,
        depot_lng=depot_lng,
        stops=_nearest_neighbour_initial(stops, depot_lat, depot_lng),
    )

    alns = ALNS(rng)

    alns.add_destroy_operator(random_removal)
    alns.add_destroy_operator(worst_removal)

    alns.add_repair_operator(greedy_insert)
    alns.add_repair_operator(random_insert)

    # Scale temperature to the objective magnitude (km). Fixed temps like 1.0 can
    # make SA effectively never accept worse solutions once deltas are a few km.
    legs = max(2, len(initial.stops) + 1)  # depot->...->depot
    avg_leg_km = max(1e-6, initial.objective() / legs)
    start_temp = max(0.5, avg_leg_km)
    end_temp = max(0.01, start_temp * 0.01)

    # Cool from start_temp to end_temp over max_iterations.
    if max_iterations <= 1 or start_temp <= end_temp:
        step = 0.999
    else:
        step = float((end_temp / start_temp) ** (1.0 / (max_iterations - 1)))
        step = min(0.999999, max(0.90, step))

    accept = SimulatedAnnealing(
        start_temperature=start_temp,
        end_temperature=end_temp,
        step=step,
    )

    op_select = RandomSelect(
        num_destroy=1,
        num_repair=1,
    )

    stop = MaxIterations(max_iterations)

    result = alns.iterate(initial, op_select, accept, stop)
    return result.best_state

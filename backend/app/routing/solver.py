import numpy as np
from alns import ALNS
from alns.accept import SimulatedAnnealing
from alns.select import RandomSelect
from alns.stop import MaxIterations

from app.routing.state import RouteState, Stop
from app.routing.operators.destroy import random_removal, worst_removal
from app.routing.operators.repair import greedy_insert, random_insert


def solve(
    stops: list[Stop],
    depot_lat: float,
    depot_lng: float,
    seed: int = 42,
    max_iterations: int = 1_000,
) -> RouteState:
    """
    Build an initial solution and run ALNS.

    Returns the best RouteState found.
    """
    rng = np.random.default_rng(seed)

    initial = RouteState(
        depot_lat=depot_lat,
        depot_lng=depot_lng,
        stops=list(stops),  # start with all stops assigned in given order
    )

    alns = ALNS(rng)

    alns.add_destroy_operator(random_removal)
    alns.add_destroy_operator(worst_removal)

    alns.add_repair_operator(greedy_insert)
    alns.add_repair_operator(random_insert)

    # SimulatedAnnealing(start_temp, end_temp, step)
    # Tune these once you have real distance data.
    accept = SimulatedAnnealing(
        start_temperature=1.0,
        end_temperature=0.01,
        step=0.9998,
    )

    op_select = RandomSelect(
        num_destroy=2,
        num_repair=2,
    )

    stop = MaxIterations(max_iterations)

    result = alns.iterate(initial, op_select, accept, stop)
    return result.best_state

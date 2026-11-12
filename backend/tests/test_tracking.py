"""B3: tracking reports what the route schedule says, never a made-up ETA."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from app.api.routes import tracking
from app.routing.eta import _eta_from_waypoints


class FakeQuery:
    def __init__(self, result):
        self._result = result

    def join(self, *_):
        return self

    def filter(self, *_):
        return self

    def first(self):
        return self._result

    def all(self):
        return self._result


class FakeSession:
    def __init__(self, order, shipment=None, order_statuses=None):
        self._order = order
        self._shipment = shipment
        self._order_statuses = order_statuses or {}

    def query(self, entity, *columns):
        if entity is tracking.Shipment:
            return FakeQuery(self._shipment)
        if columns:  # query(Order.id, Order.status): the current-status lookup
            return FakeQuery(list(self._order_statuses.items()))
        return FakeQuery(self._order)


def _order(**overrides):
    base = dict(
        id=5,
        status="Processing",
        shipment_id=None,
        route_waypoints=None,
        merchant=SimpleNamespace(merchant_name="Farm A"),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def _track(db):
    return tracking.get_order_tracking(5, db=db, current_user=SimpleNamespace(id=1))


def test_eta_is_none_without_route_estimate():
    waypoints = [
        {"type": "pickup", "order_id": None},
        {"type": "delivery", "order_id": 7},
    ]
    assert _eta_from_waypoints(None, waypoints, 7) == (0.0, None)


def test_eta_is_stable_over_time_without_estimate():
    # The old fallback cycled every 120 s; the answer must not depend on the clock.
    first = _eta_from_waypoints(None, [], 7)
    second = _eta_from_waypoints(None, [], 7)
    assert first == second == (0.0, None)


def test_undispatched_order_is_waiting_for_shipment():
    response = _track(FakeSession(_order()))
    assert response.tracking_state == "waiting_for_shipment"
    assert response.eta_minutes is None
    assert response.progress == 0.0
    assert response.waypoints == [] and response.origin is None


def test_shipment_without_route_is_waiting_for_shipment():
    shipment = SimpleNamespace(id=9, status="pending", route_waypoints=None)
    response = _track(FakeSession(_order(shipment_id=9), shipment))
    assert response.tracking_state == "waiting_for_shipment"
    assert response.shipment_id == 9
    assert response.eta_minutes is None


def test_routed_shipment_reports_estimated_eta():
    now = datetime.now(UTC)
    waypoints = [
        {
            "type": "pickup",
            "lat": 14.6,
            "lng": 121.0,
            "label": "Farm",
            "sequence": 0,
            "total_duration_seconds": 1200,
        },
        {
            "type": "delivery",
            "order_id": 5,
            "lat": 14.61,
            "lng": 121.01,
            "label": "Stop 1",
            "sequence": 1,
            "estimated_arrival_at": (now + timedelta(minutes=10)).isoformat(),
        },
    ]
    shipment = SimpleNamespace(
        id=9,
        status="in_transit",
        route_waypoints=waypoints,
        shipped_at=now - timedelta(minutes=10),
    )
    response = _track(FakeSession(_order(shipment_id=9), shipment))
    assert response.tracking_state == "estimated"
    assert response.eta_minutes == 10
    assert 0.4 <= response.progress <= 0.6


def test_route_without_arrival_estimate_has_no_eta():
    waypoints = [
        {"type": "pickup", "lat": 14.6, "lng": 121.0, "label": "Farm", "sequence": 0},
        {
            "type": "delivery",
            "order_id": 5,
            "lat": 14.61,
            "lng": 121.01,
            "label": "Stop 1",
            "sequence": 1,
        },
    ]
    response = _track(FakeSession(_order(status="Shipped", route_waypoints=waypoints)))
    assert response.eta_minutes is None
    assert response.progress == 0.0


def _two_stop_route():
    return [
        {"type": "pickup", "lat": 14.6, "lng": 121.0, "label": "Farm", "sequence": 0},
        {
            "type": "delivery",
            "order_id": 5,
            "lat": 14.61,
            "lng": 121.01,
            "label": "Stop 1",
            "sequence": 1,
            "status": "in_transit",
        },
        {
            "type": "delivery",
            "order_id": 6,
            "lat": 14.62,
            "lng": 121.02,
            "label": "Stop 2",
            "sequence": 2,
            "status": "in_transit",
        },
    ]


def test_stop_status_is_the_orders_current_status_not_the_dispatch_snapshot():
    shipment = SimpleNamespace(
        id=9, status="in_transit", route_waypoints=_two_stop_route(), shipped_at=None
    )
    db = FakeSession(
        _order(shipment_id=9),
        shipment,
        order_statuses={5: "delivered", 6: "out_for_delivery"},
    )
    response = _track(db)
    assert [s.status for s in response.stops] == ["delivered"]
    delivery = [w for w in response.waypoints if w.type == "delivery"]
    assert [w.status for w in delivery] == ["delivered"]


def test_current_statuses_leave_pickup_and_unknown_orders_alone():
    db = FakeSession(None, order_statuses={6: "cancelled"})
    route = _two_stop_route()
    updated = tracking.with_current_order_statuses(db, route)
    assert "status" not in updated[0]
    assert updated[1]["status"] == "in_transit"  # order 5 not found: keep snapshot
    assert updated[2]["status"] == "cancelled"
    assert route[2]["status"] == "in_transit"  # the stored route is not mutated

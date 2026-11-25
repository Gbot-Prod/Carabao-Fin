"""Which orders a merchant may put on a shipment, and the shipment list summary."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, get_db
from app.api.routes import shipments
from app.models.order import Order
from app.models.order_proof_photo import OrderProofPhoto
from app.models.shipment import Shipment
from app.models.user import User


def _client(db, merchant) -> TestClient:
    app = FastAPI()
    app.include_router(shipments.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: db.get(User, merchant.user_id)
    return TestClient(app)


def _order(db, merchant, buyer, status, shipment_id=None, packed=True):
    user, _ = buyer
    order = Order(
        user_id=user.id,
        merchant_id=merchant.id,
        status=status,
        total_price=500,
        items=[],
        delivery_address="123 Rizal St., Malolos",
        shipment_id=shipment_id,
    )
    db.add(order)
    db.flush()
    if packed:
        # A route takes only orders with a packing photo (order_proof).
        db.add(
            OrderProofPhoto(
                order_id=order.id,
                kind="packing",
                object_key=f"proof/{order.id}/packing/x.jpg",
                sha256=f"{order.id:064x}",
                content_type="image/jpeg",
                flags=[],
            )
        )
    db.commit()
    return order


def _shipment(db, merchant, stop_count):
    shipment = Shipment(
        merchant_id=merchant.id, stop_count=stop_count, route_waypoints=[]
    )
    db.add(shipment)
    db.commit()
    return shipment


@pytest.mark.parametrize(
    "status",
    ["pending", "shipped", "out_for_delivery", "delivered", "cancelled"],
)
def test_only_processing_orders_can_ship(db, merchant, buyer, status):  # noqa: F811
    order = _order(db, merchant, buyer, status)

    resp = _client(db, merchant).post(
        "/merchants/me/shipments", json={"order_ids": [order.id]}
    )

    assert resp.status_code == 400
    assert str(order.id) in resp.json()["detail"]


def test_order_already_in_a_shipment_is_rejected(db, merchant, buyer):  # noqa: F811
    existing = _shipment(db, merchant, stop_count=1)
    order = _order(db, merchant, buyer, "processing", shipment_id=existing.id)

    resp = _client(db, merchant).post(
        "/merchants/me/shipments", json={"order_ids": [order.id]}
    )

    assert resp.status_code == 400


def test_mixed_batch_names_every_ineligible_order(db, merchant, buyer):  # noqa: F811
    ok = _order(db, merchant, buyer, "processing")
    unpaid = _order(db, merchant, buyer, "pending")
    on_road = _order(db, merchant, buyer, "out_for_delivery")

    resp = _client(db, merchant).post(
        "/merchants/me/shipments", json={"order_ids": [ok.id, unpaid.id, on_road.id]}
    )

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail.endswith(f"{unpaid.id}, {on_road.id}")
    assert db.query(Shipment).count() == 0


def test_shipment_list_counts_completed_stops(db, merchant, buyer):  # noqa: F811
    done = _shipment(db, merchant, stop_count=2)
    _order(db, merchant, buyer, "delivered", shipment_id=done.id)
    _order(db, merchant, buyer, "cancelled", shipment_id=done.id)

    active = _shipment(db, merchant, stop_count=2)
    _order(db, merchant, buyer, "delivered", shipment_id=active.id)
    _order(db, merchant, buyer, "out_for_delivery", shipment_id=active.id)

    empty = _shipment(db, merchant, stop_count=1)

    shipments = _client(db, merchant).get("/merchants/me/shipments").json()
    rows = {s["id"]: s for s in shipments}

    assert rows[done.id]["completed_stop_count"] == 2
    assert rows[active.id]["completed_stop_count"] == 1
    assert rows[empty.id]["completed_stop_count"] == 0


def test_shipment_tracking_shows_live_stop_statuses(db, merchant, buyer):  # noqa: F811
    # The route is a dispatch snapshot; the merchant view must read each stop's
    # status from its order now, without writing back into the route.
    shipment = _shipment(db, merchant, stop_count=2)
    delivered = _order(db, merchant, buyer, "out_for_delivery", shipment_id=shipment.id)
    pending = _order(db, merchant, buyer, "out_for_delivery", shipment_id=shipment.id)
    shipment.route_waypoints = [
        {
            "type": "pickup",
            "lat": 14.6,
            "lng": 121.0,
            "label": "Farm",
            "sequence": 0,
            "total_duration_seconds": 1800,
        },
        *(
            {
                "type": "delivery",
                "order_id": order.id,
                "lat": 14.6 + seq / 100,
                "lng": 121.0,
                "label": f"Stop {seq}",
                "sequence": seq,
                "status": "in_transit",
                "estimated_arrival_at": "2026-11-13T10:00:00+00:00",
            }
            for seq, order in enumerate([delivered, pending], start=1)
        ),
    ]
    db.commit()
    delivered.status = "delivered"
    db.commit()

    resp = _client(db, merchant).get(f"/shipments/{shipment.id}")

    assert resp.status_code == 200
    body = resp.json()
    assert [s["status"] for s in body["stops"]] == ["delivered", "out_for_delivery"]
    stop_waypoints = [w for w in body["waypoints"] if w["type"] == "delivery"]
    assert [w["status"] for w in stop_waypoints] == ["delivered", "out_for_delivery"]
    assert body["stops"][0]["estimated_arrival_at"] == "2026-11-13T10:00:00+00:00"
    assert body["total_duration_seconds"] == 1800
    db.refresh(shipment)
    assert all(
        w.get("status") == "in_transit"
        for w in shipment.route_waypoints
        if w["type"] == "delivery"
    )


# --- A stop that cannot be routed does not block the run ---------------------

MALOLOS = (14.8433, 120.8114)


def _routable(monkeypatch, merchant, *, unroutable_address=None, no_road=()):
    """Pins and Mapbox stubbed: the farm is pinned; each order's address
    geocodes to its own spot, except ``unroutable_address``; stops whose
    order id is in ``no_road`` get no road route from anywhere."""
    merchant.lat, merchant.lng = MALOLOS

    def geocode(address):
        if address == unroutable_address:
            return None
        return (14.80 + 0.001 * (hash(address) % 50), 120.80)

    monkeypatch.setattr(shipments, "_geocode", geocode)
    monkeypatch.setattr(shipments, "_get_leg_durations", lambda coords: None)

    def matrix(coords):
        n = len(coords)
        rows = [[0.0 if i == j else 60.0 for j in range(n)] for i in range(n)]
        for k, (lat, _lng) in enumerate(coords):
            if (lat, _lng) in blocked:
                for i in range(n):
                    if i != k:
                        rows[i][k] = rows[k][i] = None
        return rows

    blocked: set[tuple[float, float]] = set()
    monkeypatch.setattr(shipments, "_get_duration_matrix", matrix)
    return blocked


def test_unlocatable_stop_is_left_out_not_the_whole_run(
    db, merchant, buyer, monkeypatch
):  # noqa: F811
    _routable(monkeypatch, merchant, unroutable_address="Nowhere St.")
    a = _order(db, merchant, buyer, "processing")
    b = _order(db, merchant, buyer, "processing")
    lost = _order(db, merchant, buyer, "processing")
    a.delivery_address, b.delivery_address = "1 Rizal St., Malolos", "2 Mabini St."
    lost.delivery_address = "Nowhere St."
    db.commit()

    resp = _client(db, merchant).post(
        "/merchants/me/shipments", json={"order_ids": [a.id, b.id, lost.id]}
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert sorted(body["order_ids"]) == sorted([a.id, b.id])
    assert body["skipped_orders"] == [{"order_id": lost.id, "reason": "no_location"}]
    db.refresh(lost)
    assert lost.status == "processing" and lost.shipment_id is None


def test_stop_without_a_road_route_is_left_out(db, merchant, buyer, monkeypatch):  # noqa: F811
    blocked = _routable(monkeypatch, merchant)
    a = _order(db, merchant, buyer, "processing")
    b = _order(db, merchant, buyer, "processing")
    island = _order(db, merchant, buyer, "processing")
    a.delivery_address, b.delivery_address = "1 Rizal St., Malolos", "2 Mabini St."
    island.delivery_lat, island.delivery_lng = 14.7, 120.9
    island.delivery_pin_confirmed = True
    blocked.add((14.7, 120.9))
    db.commit()

    resp = _client(db, merchant).post(
        "/merchants/me/shipments", json={"order_ids": [a.id, b.id, island.id]}
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["skipped_orders"] == [
        {"order_id": island.id, "reason": "no_road"}
    ]
    assert island.id not in resp.json()["order_ids"]


def test_every_stop_unlocatable_is_still_an_error(db, merchant, buyer, monkeypatch):  # noqa: F811
    _routable(monkeypatch, merchant, unroutable_address="Nowhere St.")
    lost = _order(db, merchant, buyer, "processing")
    lost.delivery_address = "Nowhere St."
    db.commit()

    resp = _client(db, merchant).post(
        "/merchants/me/shipments", json={"order_ids": [lost.id]}
    )

    assert resp.status_code == 422
    assert str(lost.id) in resp.json()["detail"]


def test_unroutable_indices_drop_only_the_cut_off_stop():
    ok, no = 60.0, None
    # Pickup, two reachable stops, and stop 3 with no road to anything.
    matrix = [
        [0, ok, ok, no],
        [ok, 0, ok, no],
        [ok, ok, 0, no],
        [no, no, no, 0],
    ]
    assert shipments._unroutable_indices(matrix) == {3}
    full = [[0, ok], [ok, 0]]
    assert shipments._unroutable_indices(full) == set()

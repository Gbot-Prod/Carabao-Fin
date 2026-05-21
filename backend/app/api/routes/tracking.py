from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.shipment import Shipment
from app.models.user import User
from app.routing.eta import _eta_from_waypoints
from app.schemas.shipment import ShipmentStop, ShipmentTrackingResponse, TrackingPosition, Waypoint

router = APIRouter(tags=["tracking"])


def _response_from_stored_route(
    route_waypoints: list[dict],
    *,
    shipment_id: int,
    order_id: int,
    merchant_name: str,
    status: str,
    shipped_at: datetime | None = None,
    highlight_order_id: int | None = None,
) -> ShipmentTrackingResponse:
    if not route_waypoints:
        raise HTTPException(status_code=412, detail="Route not ready yet")

    waypoints = [Waypoint(**p) for p in route_waypoints]
    stop_points = [p for p in route_waypoints if p.get("type") != "pickup" and p.get("order_id") is not None]
    stops = [
        ShipmentStop(
            sequence=int(p.get("sequence", i + 1)),
            order_id=int(p["order_id"]),
            buyer_name=p.get("buyer_name"),
            delivery_address=p.get("delivery_address"),
            lat=float(p["lat"]),
            lng=float(p["lng"]),
            label=p.get("label", "Stop"),
            status=p.get("status", "in_transit"),
        )
        for i, p in enumerate(stop_points)
    ]

    target_id = highlight_order_id if highlight_order_id is not None else order_id
    progress, eta_minutes = _eta_from_waypoints(shipped_at, route_waypoints, target_id)
    active_idx = min(int(progress * max(len(stops), 1)), max(len(stops) - 1, 0))
    if highlight_order_id is not None:
        buyer_idx = next((i for i, s in enumerate(stops) if s.order_id == highlight_order_id), active_idx)
    else:
        buyer_idx = active_idx

    dest = stops[buyer_idx] if stops else waypoints[-1]

    # Buyer-facing view: strip other buyers' names, addresses, and GPS coordinates.
    # Merchants (highlight_order_id=None) legitimately see all stops.
    if highlight_order_id is not None:
        visible_stops = [s for s in stops if s.order_id == highlight_order_id]
        visible_waypoints = [
            w for w in waypoints
            if w.type == "pickup" or w.order_id == highlight_order_id
        ]
        visible_active_idx = 0
    else:
        visible_stops = stops
        visible_waypoints = waypoints
        visible_active_idx = buyer_idx

    return ShipmentTrackingResponse(
        shipment_id=shipment_id,
        order_id=order_id,
        merchant_name=merchant_name,
        status=status,
        order_ids=[s.order_id for s in visible_stops],
        waypoints=visible_waypoints,
        stops=visible_stops,
        origin=TrackingPosition(lat=waypoints[0].lat, lng=waypoints[0].lng),
        destination=TrackingPosition(lat=dest.lat, lng=dest.lng),
        progress=progress,
        eta_minutes=eta_minutes,
        active_stop_index=visible_active_idx,
    )


@router.get("/tracking/{order_id}", response_model=ShipmentTrackingResponse)
async def get_order_tracking(
    order_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    order = (
        db.query(Order)
        .join(OrderHistory)
        .filter(Order.id == order_id, OrderHistory.user_id == current_user.id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    merchant_name = order.merchant.merchant_name if order.merchant else "Merchant"

    # Batch shipment — read the pre-computed multi-stop route, no geocoding needed
    if order.shipment_id:
        shipment = db.query(Shipment).filter(Shipment.id == order.shipment_id).first()
        if not shipment or not shipment.route_waypoints:
            raise HTTPException(status_code=412, detail="Shipment route not ready yet")
        return _response_from_stored_route(
            shipment.route_waypoints,
            shipment_id=shipment.id,
            order_id=order_id,
            merchant_name=merchant_name,
            status=shipment.status,
            shipped_at=shipment.shipped_at,
            highlight_order_id=order_id,
        )

    # Single-order manual dispatch — route stored when merchant marked it shipped
    if order.route_waypoints:
        return _response_from_stored_route(
            order.route_waypoints,
            shipment_id=0,
            order_id=order_id,
            merchant_name=merchant_name,
            status=order.status,
            shipped_at=None,
            highlight_order_id=order_id,
        )

    raise HTTPException(
        status_code=412,
        detail="Order has not been dispatched yet",
    )

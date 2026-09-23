from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone

import requests as _requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.api.dependencies import get_current_user, get_db
from app.models.current_orders import CurrentOrder
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.shipment import Shipment
from app.models.user import User
from app.routing.eta import _eta_from_waypoints
from app.routing.service import compute_route
from app.routing.state import Stop
from app.schemas.shipment import CreateShipmentRequest, ShipmentStop, ShipmentTrackingResponse, TrackingPosition, Waypoint
from app.utils.geocoding import _geocode

router = APIRouter(tags=["shipments"])


def _resolve_delivery_address(order: Order, buyer: User | None) -> str | None:
	if order.delivery_address:
		return order.delivery_address
	parts = [part for part in [buyer.address if buyer else None, buyer.city if buyer else None] if part]
	return ", ".join(parts) if parts else None


async def _get_leg_durations(coords: list[tuple[float, float]]) -> list[float] | None:
	"""Calls Mapbox Directions and returns cumulative driving duration (seconds) from coords[0] to each subsequent coord."""
	token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
	if not token or len(coords) < 2:
		return None
	coord_str = ";".join(f"{lng},{lat}" for lat, lng in coords)
	url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{coord_str}"
	try:
		loop = asyncio.get_running_loop()
		resp = await loop.run_in_executor(
			None,
			lambda: _requests.get(url, params={"access_token": token, "overview": "false"}, timeout=10),
		)
		if not resp.ok:
			print(f"[shipment-directions] Mapbox error {resp.status_code}")
			return None
		legs = resp.json().get("routes", [{}])[0].get("legs", [])
		cumulative, total = [], 0.0
		for leg in legs:
			total += leg.get("duration", 0.0)
			cumulative.append(total)
		return cumulative
	except Exception as exc:
		print(f"[shipment-directions] Exception: {exc}")
		return None


def _shipment_response(
	shipment: Shipment,
	merchant_name: str,
	selected_order_id: int,
	selected_destination: tuple[float, float],
) -> ShipmentTrackingResponse:
	route_waypoints = shipment.route_waypoints or []
	if not route_waypoints:
		raise HTTPException(status_code=412, detail="Shipment route is not available yet")

	waypoints = [Waypoint(**point) for point in route_waypoints]
	stop_points = [point for point in route_waypoints if point.get("type") != "pickup"]
	stops = [
		ShipmentStop(
			sequence=int(point.get("sequence", index + 1)),
			order_id=int(point["order_id"]),
			buyer_name=point.get("buyer_name"),
			delivery_address=point.get("delivery_address"),
			lat=float(point["lat"]),
			lng=float(point["lng"]),
			label=point.get("label", "Stop"),
			status=point.get("status", "in_transit"),
		)
		for index, point in enumerate(stop_points)
	]

	progress, eta_minutes = _eta_from_waypoints(shipment.shipped_at, route_waypoints, selected_order_id)
	active_stop_index = min(max(int(progress * max(len(stops), 1)), 0), max(len(stops) - 1, 0))

	return ShipmentTrackingResponse(
		shipment_id=shipment.id,
		order_id=selected_order_id,
		merchant_name=merchant_name,
		status=shipment.status,
		order_ids=[stop.order_id for stop in stops],
		waypoints=waypoints,
		stops=stops,
		origin=TrackingPosition(lat=waypoints[0].lat, lng=waypoints[0].lng),
		destination=TrackingPosition(lat=selected_destination[0], lng=selected_destination[1]),
		progress=progress,
		eta_minutes=eta_minutes,
		active_stop_index=active_stop_index,
	)


@router.post("/merchants/me/shipments", response_model=ShipmentTrackingResponse)
async def create_merchant_shipment(
	payload: CreateShipmentRequest,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
	if not merchant:
		raise HTTPException(status_code=404, detail="Merchant profile not found")

	order_ids = list(dict.fromkeys(payload.order_ids))
	if not order_ids:
		raise HTTPException(status_code=400, detail="Select at least one order to create a shipment")

	orders = (
		db.query(Order)
		.options(joinedload(Order.order_history).joinedload(OrderHistory.user))
		.filter(Order.id.in_(order_ids), Order.merchant_id == merchant.id)
		.order_by(Order.id.asc())
		.all()
	)
	if len(orders) != len(order_ids):
		raise HTTPException(status_code=404, detail="One or more orders were not found for this merchant")

	blocked = [order.id for order in orders if order.status.lower() in {"shipped", "delivered", "cancelled"}]
	if blocked:
		raise HTTPException(status_code=400, detail=f"Orders already shipped or closed: {', '.join(map(str, blocked))}")

	if not merchant.location:
		raise HTTPException(status_code=422, detail="Merchant has no location set")

	origin_coords = await _geocode(merchant.location)
	if not origin_coords:
		raise HTTPException(status_code=422, detail=f"Could not geocode merchant address: {merchant.location!r}")

	order_contexts: list[dict[str, object]] = []
	for order in orders:
		buyer = order.order_history.user if order.order_history else None
		delivery_address = _resolve_delivery_address(order, buyer)
		if not delivery_address:
			raise HTTPException(status_code=422, detail=f"Order {order.id} has no delivery address")
		order_contexts.append({
			"order": order,
			"buyer": buyer,
			"delivery_address": delivery_address,
		})

	destination_results = await asyncio.gather(*[_geocode(str(ctx["delivery_address"])) for ctx in order_contexts])
	if any(result is None for result in destination_results):
		failed = [str(order_contexts[index]["order"].id) for index, result in enumerate(destination_results) if result is None]
		raise HTTPException(status_code=422, detail=f"Could not geocode delivery address for orders: {', '.join(failed)}")

	stops = []
	for ctx, destination in zip(order_contexts, destination_results, strict=True):
		order = ctx["order"]
		assert isinstance(order, Order)
		assert destination is not None
		stops.append(Stop(order_id=order.id, merchant_id=merchant.id, lat=destination[0], lng=destination[1]))

	ordered_stops = compute_route(stops=stops, depot_lat=origin_coords[0], depot_lng=origin_coords[1])
	ordered_stop_map = {stop.order_id: stop for stop in ordered_stops}

	shipment = Shipment(
		merchant_id=merchant.id,
		status="in_transit",
		stop_count=len(ordered_stops),
		route_waypoints=[],
		shipped_at=datetime.now(timezone.utc),
	)
	db.add(shipment)
	db.flush()

	merchant_name = merchant.merchant_name or "Merchant"
	waypoints = [
		{
			"sequence": 0,
			"order_id": None,
			"lat": origin_coords[0],
			"lng": origin_coords[1],
			"label": f"Pickup: {merchant_name}",
			"type": "pickup",
			"status": "pickup",
		}
	]

	for sequence, stop in enumerate(ordered_stops, start=1):
		ctx = next(context for context in order_contexts if context["order"].id == stop.order_id)
		buyer = ctx["buyer"]
		assert isinstance(ctx["order"], Order)
		buyer_full_name = (
			f"{buyer.first_name} {buyer.last_name}".strip()
			if buyer and buyer.first_name and buyer.last_name
			else None
		)
		waypoints.append({
			"sequence": sequence,
			"order_id": stop.order_id,
			"lat": stop.lat,
			"lng": stop.lng,
			"label": buyer_full_name or f"Order #{stop.order_id}",
			"delivery_address": ctx["delivery_address"],
			"buyer_name": buyer_full_name,
			"type": "delivery",
			"status": "in_transit",
		})

	# Enrich waypoints with Mapbox road-based arrival times
	all_coords = [(origin_coords[0], origin_coords[1])] + [(s.lat, s.lng) for s in ordered_stops]
	durations = await _get_leg_durations(all_coords)
	now = datetime.now(timezone.utc)
	if durations:
		total_duration = durations[-1]
		waypoints[0]["total_duration_seconds"] = total_duration
		for seq_idx, wp in enumerate(waypoints[1:]):
			if seq_idx < len(durations):
				arrival_dt = now + timedelta(seconds=durations[seq_idx])
				wp["estimated_arrival_at"] = arrival_dt.isoformat()
				wp["duration_seconds"] = durations[seq_idx]

	shipment.route_waypoints = waypoints

	for ctx in order_contexts:
		order = ctx["order"]
		assert isinstance(order, Order)
		order.shipment_id = shipment.id
		order.status = "shipped"
		if order.current_order:
			order.current_order.status = "shipped"
			wp = next((w for w in waypoints if w.get("order_id") == order.id), None)
			if wp and wp.get("estimated_arrival_at"):
				order.current_order.time_of_arrival = datetime.fromisoformat(wp["estimated_arrival_at"])

	db.commit()
	db.refresh(shipment)

	selected_order = ordered_stops[0] if ordered_stops else stops[0]
	selected_destination = (selected_order.lat, selected_order.lng)
	return _shipment_response(shipment, merchant_name, selected_order.order_id, selected_destination)


@router.get("/shipments/{shipment_id}", response_model=ShipmentTrackingResponse)
async def get_shipment_tracking(
	shipment_id: int,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
	if not merchant:
		raise HTTPException(status_code=404, detail="Merchant profile not found")

	shipment = db.query(Shipment).filter(Shipment.id == shipment_id, Shipment.merchant_id == merchant.id).first()
	if not shipment:
		raise HTTPException(status_code=404, detail="Shipment not found")

	first_order = (
		db.query(Order)
		.filter(Order.shipment_id == shipment.id)
		.order_by(Order.id.asc())
		.first()
	)
	if not first_order:
		raise HTTPException(status_code=404, detail="Shipment has no orders")

	delivery_points = [point for point in shipment.route_waypoints or [] if point.get("type") != "pickup"]
	selected_destination = delivery_points[0] if delivery_points else (shipment.route_waypoints or [{}])[0]

	return _shipment_response(
		shipment=shipment,
		merchant_name=merchant.merchant_name or "Merchant",
		selected_order_id=first_order.id,
		selected_destination=(float(selected_destination.get("lat", 0.0)), float(selected_destination.get("lng", 0.0))),
	)


@router.get("/merchants/me/shipments")
async def list_my_shipments(
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	merchant = db.query(Merchant).filter(Merchant.user_id == current_user.id).first()
	if not merchant:
		raise HTTPException(status_code=404, detail="Merchant profile not found")

	rows = (
		db.query(Shipment)
		.filter(Shipment.merchant_id == merchant.id)
		.order_by(Shipment.created_at.desc())
		.all()
	)

	return [
		{
			"id": s.id,
			"status": s.status,
			"stop_count": s.stop_count,
			"created_at": s.created_at,
			"shipped_at": s.shipped_at,
		}
		for s in rows
	]
from __future__ import annotations

import asyncio
import math
import os
import time
from datetime import datetime, timezone
from urllib.parse import quote

import requests as _requests
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.current_orders import CurrentOrder
from app.models.merchant import Merchant
from app.models.order import Order
from app.models.order_history import OrderHistory
from app.models.shipment import Shipment
from app.models.user import User
from app.routing.service import compute_route
from app.routing.state import Stop
from app.schemas.shipment import CreateShipmentRequest, ShipmentStop, ShipmentTrackingResponse, TrackingPosition, Waypoint

router = APIRouter(tags=["shipments"])

_CYCLE_SECONDS = 120
_PH_BBOX = "116.928,4.587,126.604,21.321"
_METRO_MANILA_PROXIMITY = "120.9842,14.5995"
_geocode_cache: dict[str, tuple[float, float]] = {}


def _normalise_address(address: str) -> str:
	cleaned = address.strip()
	lower = cleaned.lower()
	if "philippines" not in lower and ", ph" not in lower:
		cleaned = f"{cleaned}, Philippines"
	return cleaned


def _geocode_sync(address: str) -> tuple[float, float] | None:
	token = os.getenv("MAPBOX_ACCESS_TOKEN", "")
	if not token or not address.strip():
		return None

	normalised = _normalise_address(address)
	url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{quote(normalised)}.json"
	try:
		resp = _requests.get(
			url,
			params={
				"country": "PH",
				"bbox": _PH_BBOX,
				"proximity": _METRO_MANILA_PROXIMITY,
				"types": "address,poi,place,locality,neighborhood",
				"limit": 1,
				"access_token": token,
			},
			timeout=5,
		)
		if not resp.ok:
			print(f"[shipment-geocode] Mapbox error {resp.status_code} for address: {normalised!r}")
			return None

		body = resp.json()
		features = body.get("features", [])
		if not features:
			print(f"[shipment-geocode] No results for address: {normalised!r}")
			return None

		lng, lat = features[0]["center"]
		return (lat, lng)
	except Exception as exc:
		print(f"[shipment-geocode] Exception for address {normalised!r}: {exc}")
		return None


async def _geocode(address: str) -> tuple[float, float] | None:
	key = address.strip().lower()
	if key in _geocode_cache:
		return _geocode_cache[key]
	loop = asyncio.get_running_loop()
	result = await loop.run_in_executor(None, _geocode_sync, address)
	if result:
		_geocode_cache[key] = result
	return result


def _resolve_delivery_address(order: Order, buyer: User | None) -> str | None:
	if order.delivery_address:
		return order.delivery_address
	parts = [part for part in [buyer.address if buyer else None, buyer.city if buyer else None] if part]
	return ", ".join(parts) if parts else None


def _current_progress() -> tuple[float, int]:
	elapsed = time.time() % _CYCLE_SECONDS
	progress = round(elapsed / _CYCLE_SECONDS, 4)
	eta_minutes = math.ceil((1.0 - progress) * _CYCLE_SECONDS / 60)
	return progress, eta_minutes


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

	progress, eta_minutes = _current_progress()
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
		order_history = db.query(OrderHistory).filter(OrderHistory.id == order.order_history_id).first()
		buyer = db.query(User).filter(User.id == order_history.user_id).first() if order_history else None
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
		waypoints.append({
			"sequence": sequence,
			"order_id": stop.order_id,
			"lat": stop.lat,
			"lng": stop.lng,
			"label": getattr(buyer, "first_name", None) and getattr(buyer, "last_name", None)
				and f"{buyer.first_name} {buyer.last_name}".strip()
				or f"Order #{stop.order_id}",
			"delivery_address": ctx["delivery_address"],
			"buyer_name": getattr(buyer, "first_name", None) and getattr(buyer, "last_name", None)
				and f"{buyer.first_name} {buyer.last_name}".strip()
				or None,
			"type": "delivery",
			"status": "in_transit",
		})

	shipment.route_waypoints = waypoints

	for ctx in order_contexts:
		order = ctx["order"]
		assert isinstance(order, Order)
		order.shipment_id = shipment.id
		order.status = "shipped"
		if order.current_order:
			order.current_order.status = "shipped"

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
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TrackingState = Literal["estimated", "waiting_for_shipment"]


class TrackingPosition(BaseModel):
    lat: float
    lng: float


class Waypoint(BaseModel):
    lat: float
    lng: float
    label: str
    type: str
    sequence: int
    order_id: int | None = None
    status: str | None = None


class ShipmentStop(BaseModel):
    sequence: int
    order_id: int
    buyer_name: str | None = None
    delivery_address: str | None = None
    lat: float
    lng: float
    label: str
    status: str
    # Planned arrival from the route schedule (merchant view only); not GPS.
    estimated_arrival_at: str | None = None
    # The rider reported that this stop's pin could not be reached (control 6).
    pin_unreachable: bool = False
    # The buyer never placed this pin: it is where the address geocoded to.
    pin_approximate: bool = False
    # Set by the server: a rider delivered to this pin before and did not
    # report it (services/pinned_location.py delivery_pin_verified).
    pin_verified: bool = False
    # The pin was saved while the road service was down, and the check before
    # this route found no road near it.
    pin_no_road: bool = False


class SkippedStop(BaseModel):
    """An order left off a new shipment; it stays ready to ship."""

    order_id: int
    # no_location: no pin and the address could not be found on the map.
    # no_road: no road route reaches it from the pickup or the other stops.
    reason: Literal["no_location", "no_road"]


class RouteGeometryResponse(BaseModel):
    """The road line for a tracking or routing map: a GeoJSON LineString
    Feature through the response's waypoints, or null when there is none."""

    route: dict[str, Any] | None = None


class ShipmentTrackingResponse(BaseModel):
    shipment_id: int
    order_id: int
    merchant_name: str
    status: str
    order_ids: list[int]
    waypoints: list[Waypoint]
    stops: list[ShipmentStop]
    origin: TrackingPosition | None
    destination: TrackingPosition | None
    # Estimated from the route schedule; there is no live vehicle location.
    progress: float
    eta_minutes: int | None
    active_stop_index: int
    # Planned drive time for the whole route (merchant view only).
    total_duration_seconds: float | None = None
    tracking_state: TrackingState = "estimated"
    # Only on create: orders left out because they could not be routed.
    skipped_orders: list[SkippedStop] = []


# Pickup + 20 stops = 21 points, inside the Mapbox Matrix API's 25-point
# limit, so every shipment is routed from a single matrix request.
MAX_SHIPMENT_ORDERS = 20


class PinUnreachableRequest(BaseModel):
    note: str | None = Field(default=None, max_length=200)

    model_config = ConfigDict(extra="forbid")


class CreateShipmentRequest(BaseModel):
    order_ids: list[int] = Field(min_length=1, max_length=MAX_SHIPMENT_ORDERS)

    model_config = ConfigDict(extra="forbid")  # CF-0051

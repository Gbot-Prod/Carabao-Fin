from pydantic import BaseModel, Field


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


class ShipmentTrackingResponse(BaseModel):
	shipment_id: int
	order_id: int
	merchant_name: str
	status: str
	order_ids: list[int]
	waypoints: list[Waypoint]
	stops: list[ShipmentStop]
	origin: TrackingPosition
	destination: TrackingPosition
	progress: float
	eta_minutes: int
	active_stop_index: int


class CreateShipmentRequest(BaseModel):
	order_ids: list[int] = Field(min_length=1)
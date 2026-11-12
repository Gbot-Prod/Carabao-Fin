import { apiClient } from './client';

export type TrackingPosition = { lat: number; lng: number };

export type Waypoint = {
  lat: number;
  lng: number;
  label: string;
  type: 'pickup' | 'delivery';
  sequence: number;
  order_id?: number | null;
  status?: string | null;
};

export type ShipmentStop = {
  sequence: number;
  order_id: number;
  buyer_name: string | null;
  delivery_address: string | null;
  lat: number;
  lng: number;
  label: string;
  status: string;
};

// 'estimated': progress and ETA come from the planned route schedule (no live GPS).
// 'waiting_for_shipment': no route yet, so there is no ETA to show.
export type TrackingState = 'estimated' | 'waiting_for_shipment';

export type TrackingData = {
  shipment_id: number;
  order_id: number;
  merchant_name: string;
  status: string;
  order_ids: number[];
  waypoints: Waypoint[];
  stops: ShipmentStop[];
  origin: TrackingPosition | null;
  destination: TrackingPosition | null;
  progress: number;
  eta_minutes: number | null;
  active_stop_index: number;
  tracking_state: TrackingState;
};

export const fetchTracking = async (orderId: number): Promise<TrackingData> => {
  const response = await apiClient.get<TrackingData>(`/tracking/${orderId}`);
  return response.data;
};

export const fetchShipmentTracking = async (shipmentId: number): Promise<TrackingData> => {
  const response = await apiClient.get<TrackingData>(`/shipments/${shipmentId}`);
  return response.data;
};

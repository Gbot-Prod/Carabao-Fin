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

export type TrackingData = {
  shipment_id: number;
  order_id: number;
  merchant_name: string;
  status: string;
  order_ids: number[];
  waypoints: Waypoint[];
  stops: ShipmentStop[];
  origin: TrackingPosition;
  destination: TrackingPosition;
  progress: number;
  eta_minutes: number;
  active_stop_index: number;
};

export const fetchTracking = async (orderId: number): Promise<TrackingData> => {
  const response = await apiClient.get<TrackingData>(`/tracking/${orderId}`);
  return response.data;
};

export const fetchShipmentTracking = async (shipmentId: number): Promise<TrackingData> => {
  const response = await apiClient.get<TrackingData>(`/shipments/${shipmentId}`);
  return response.data;
};

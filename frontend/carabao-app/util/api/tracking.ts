import { apiClient } from './client';

export type TrackingPosition = { lat: number; lng: number };

export type Waypoint = {
  lat: number;
  lng: number;
  label: string;
  type: 'pickup' | 'delivery';
};

export type TrackingData = {
  order_id: number;
  waypoints: Waypoint[];
  origin: TrackingPosition;
  destination: TrackingPosition;
  progress: number;
  eta_minutes: number;
};

export const fetchTracking = async (orderId: number): Promise<TrackingData> => {
  const response = await apiClient.get<TrackingData>(`/tracking/${orderId}`);
  return response.data;
};

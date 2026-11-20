import { apiClient } from './client';

/** Pin check before save (pin quality, control 5). The save routes check again. */
export type PinCheckResult = {
  lat: number;
  lng: number;
  /** The point on the nearest road, where the rider stops. Null: not checked. */
  road_lat: number | null;
  road_lng: number | null;
  road_distance_m: number | null;
  /** Rider reports near this pin on the person's own orders (control 6). */
  unreachable_reports: number;
  /** Checkout refuses this pin until it is moved. */
  blocked: boolean;
};

export const checkPin = async (pin: { lat: number; lng: number }): Promise<PinCheckResult> => {
  const response = await apiClient.post<PinCheckResult>('/locations/pin-check', pin);
  return response.data;
};

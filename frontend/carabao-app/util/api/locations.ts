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

/** `strict`: refuse (503) when the road check did not run (merchant pickup pins). */
export const checkPin = async (
  pin: { lat: number; lng: number },
  strict = false,
): Promise<PinCheckResult> => {
  const response = await apiClient.post<PinCheckResult>('/locations/pin-check', { ...pin, strict });
  return response.data;
};

/** A Mapbox place, trimmed by the API to what the pin picker reads. */
export type PlaceFeature = {
  id?: string | null;
  place_type?: string[];
  text?: string | null;
  place_name?: string | null;
  center?: [number, number];
  context?: { id: string; text: string }[];
};

type PlaceResponse = { feature: PlaceFeature | null };

/** Forward geocoding for the map pin, through the API (Mapbox token stays server-side). */
export const geocodePlace = async (query: string): Promise<PlaceFeature | undefined> => {
  const response = await apiClient.post<PlaceResponse>('/locations/geocode', { query: query.slice(0, 256) });
  return response.data.feature ?? undefined;
};

/** One row in the dropdown under the street field. `center` is [lng, lat]; null: ask placeById. */
export type PlaceSuggestion = { id: string; title: string; subtitle: string; center: [number, number] | null };

/** Street suggestions while the person types. `session` groups the typing and the pick (Google billing). */
export const suggestPlaces = async (query: string, session: string): Promise<PlaceSuggestion[]> => {
  const response = await apiClient.post<{ suggestions: PlaceSuggestion[] }>('/locations/suggest', {
    query: query.slice(0, 256),
    session,
  });
  return response.data.suggestions ?? [];
};

/** The coordinates of a picked suggestion that came without them. */
export const placeById = async (id: string, session: string): Promise<PlaceFeature | undefined> => {
  const response = await apiClient.post<PlaceResponse>('/locations/place', { id, session });
  return response.data.feature ?? undefined;
};

/** The place at a pin, through the API. */
export const reverseGeocodePlace = async (pin: { lat: number; lng: number }): Promise<PlaceFeature | undefined> => {
  const response = await apiClient.post<PlaceResponse>('/locations/reverse-geocode', pin);
  return response.data.feature ?? undefined;
};

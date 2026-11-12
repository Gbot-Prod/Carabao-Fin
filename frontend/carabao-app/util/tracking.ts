import along from '@turf/along';
import length from '@turf/length';
import type { Feature, LineString } from 'geojson';
import { CLOSED_ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@/util/api/statuses';
import type { TrackingData } from '@/util/api/tracking';

export type RouteGeoJSON = Feature<LineString>;

export type LatLng = { lat: number; lng: number };

/**
 * Fetches a road-following route from the Mapbox Directions API.
 * Accepts 2+ waypoints; Mapbox will route through all of them in order.
 * Returns null if the request fails or no route is found.
 */
export async function fetchRouteGeoJSON(
  waypoints: LatLng[],
  accessToken: string,
): Promise<RouteGeoJSON | null> {
  if (waypoints.length < 2) return null;

  const coords = waypoints.map(w => `${w.lng},${w.lat}`).join(';');
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${accessToken}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error('[tracking] Directions API error:', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { routes?: { geometry: LineString }[] };
    const route = data.routes?.[0];
    if (!route) {
      console.error('[tracking] Directions API returned no routes for coords:', coords);
      return null;
    }
    return { type: 'Feature', properties: {}, geometry: route.geometry };
  } catch (err) {
    console.error('[tracking] Directions API fetch threw:', err);
    return null;
  }
}

/**
 * Returns the [lng, lat] coordinate at `progress` (0–1) along a road route.
 */
export function getPositionAlongRoute(
  route: RouteGeoJSON,
  progress: number,
): [number, number] {
  const totalKm = length(route, { units: 'kilometers' });
  const distanceKm = Math.min(Math.max(progress, 0), 1) * totalKm;
  const point = along(route, distanceKm, { units: 'kilometers' });
  const [lng, lat] = point.geometry.coordinates as [number, number];
  return [lng, lat];
}

/** A stop is finished once its order is delivered or cancelled. */
export const isClosedStatus = (status: string | null | undefined): boolean =>
  !!status && (CLOSED_ORDER_STATUSES as readonly string[]).includes(status);

export const statusLabel = (status: string | null | undefined): string =>
  status
    ? ORDER_STATUS_LABELS[status as OrderStatus] ?? status.replaceAll('_', ' ')
    : 'Status unknown';

/** Every stop is delivered or cancelled: nothing left to refresh. */
export const isRouteFinished = (data: TrackingData): boolean =>
  data.stops.length > 0 && data.stops.every((stop) => isClosedStatus(stop.status));

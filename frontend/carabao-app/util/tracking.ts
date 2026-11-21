import along from '@turf/along';
import length from '@turf/length';
import type { Feature, LineString } from 'geojson';
import { CLOSED_ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@/util/api/statuses';
import { fetchOrderRoute, fetchShipmentRoute, type TrackingData } from '@/util/api/tracking';

export type RouteGeoJSON = Feature<LineString>;

export type LatLng = { lat: number; lng: number };

/** Who is looking: the buyer's order, or the merchant's whole shipment. */
export type RouteSource = { kind: 'order'; id: number } | { kind: 'shipment'; id: number };

/**
 * The road route through the map's waypoints, from the API (which asks Mapbox
 * Directions with the server token and caches the answer). Null on any failure:
 * the map then shows the stops without a line.
 */
export async function fetchRouteGeoJSON(source: RouteSource): Promise<RouteGeoJSON | null> {
  try {
    return source.kind === 'order' ? await fetchOrderRoute(source.id) : await fetchShipmentRoute(source.id);
  } catch (err) {
    console.error('[tracking] route request failed:', err);
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

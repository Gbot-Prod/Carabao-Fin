import along from '@turf/along';
import length from '@turf/length';
import type { Feature, LineString } from 'geojson';

export type RouteGeoJSON = Feature<LineString>;

export type LatLng = { lat: number; lng: number };

/**
 * Fetches a road-following route from the Mapbox Directions API.
 * Returns null if the request fails or no route is found.
 * Pure fetch — works in both Next.js and React Native.
 */
export async function fetchRouteGeoJSON(
  origin: LatLng,
  destination: LatLng,
  accessToken: string,
): Promise<RouteGeoJSON | null> {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full&access_token=${accessToken}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { routes?: { geometry: LineString }[] };
    const route = data.routes?.[0];
    if (!route) return null;
    return { type: 'Feature', properties: {}, geometry: route.geometry };
  } catch {
    return null;
  }
}

/**
 * Returns the [lng, lat] coordinate at `progress` (0–1) along a road route.
 * Uses turf.along so the point stays on the road geometry, not a straight line.
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

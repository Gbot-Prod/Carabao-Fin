// src/lib/routeMap.ts
// S12 (plan §5.4, part 2): the pure half of the route map. `GET /shipments/{id}/route` answers a
// GeoJSON LineString whose coordinates are [lng, lat] (backend app/schemas/shipment.py
// RouteGeometryResponse); react-native-maps draws { latitude, longitude }. The map also needs a
// region that holds every stop, the numbers the list and the markers share, and the shipment id a
// link may carry. `npm test` checks all of it (src/lib/routeMap.test.ts).

/** A react-native-maps coordinate, typed here so a test can import it without the native module. */
export type LatLng = { latitude: number; longitude: number };

/** What `MapView` needs to frame an area: a centre and the visible spans. */
export type MapRegion = LatLng & { latitudeDelta: number; longitudeDelta: number };

/**
 * The parts of the GeoJSON Feature `RouteGeometryResponse.route` carries that the map reads (the
 * web types it as `Feature<LineString>`; it may also be null when there is no road line).
 */
export type RouteGeoJSON = {
  type?: string;
  geometry?: {
    type?: string;
    /** [lng, lat] pairs, in GeoJSON order. */
    coordinates?: readonly (readonly number[])[];
  } | null;
};

// One stop, or two stops on the same pin, still needs a visible area (~1 km), or the map zooms in
// past the street and the marker fills the screen.
const MIN_SPAN = 0.01;
// A little room around the stops, as the web's fitBounds padding leaves.
const FIT_PADDING = 1.3;

// The marker colours, the same as the web RouteMap (components/RouteMap/RouteMap.tsx), so a stop
// reads the same colour on both clients: pickup, the next stop, other stops, closed stops.
export const PICKUP_COLOR = '#3b82f6';
export const HIGHLIGHT_STOP_COLOR = '#f59e0b';
export const OTHER_STOP_COLOR = '#ef4444';
export const CLOSED_STOP_COLOR = '#6b7280';
export const POSITION_COLOR = '#22c55e';

const isLatitude = (lat: number) => Number.isFinite(lat) && Math.abs(lat) <= 90;
const isLongitude = (lng: number) => Number.isFinite(lng) && Math.abs(lng) <= 180;

/** An API waypoint or stop (`{ lat, lng }`, as the backend sends them) as a map coordinate. */
export function toLatLng(point: { lat: number; lng: number }): LatLng {
  return { latitude: point.lat, longitude: point.lng };
}

/**
 * The road line to draw, from the API's GeoJSON. A pair that is not a usable [lng, lat] is
 * dropped rather than breaking the whole line; null (no road route) draws no line.
 */
export function routePolyline(route: RouteGeoJSON | null | undefined): LatLng[] {
  const coordinates = route?.geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  const points: LatLng[] = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [lng, lat] = pair;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!isLatitude(lat) || !isLongitude(lng)) continue;
    points.push({ latitude: lat, longitude: lng });
  }
  return points;
}

/** A region that holds every usable point, with room to spare; null when there is none. */
export function regionForPoints(points: readonly LatLng[]): MapRegion | null {
  const usable = points.filter((p) => isLatitude(p.latitude) && isLongitude(p.longitude));
  if (usable.length === 0) return null;
  const lats = usable.map((p) => p.latitude);
  const lngs = usable.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * FIT_PADDING, MIN_SPAN),
    longitudeDelta: Math.max((maxLng - minLng) * FIT_PADDING, MIN_SPAN),
  };
}

/**
 * The number a stop is read and drawn with: its route sequence (the backend's plan order), or
 * its place in the list when a value is missing, so the map never shows a blank marker.
 */
export function stopNumber(stop: { sequence?: number | null }, index: number): number {
  const sequence = stop.sequence;
  return typeof sequence === 'number' && Number.isInteger(sequence) && sequence > 0
    ? sequence
    : index + 1;
}

/**
 * The route screen's `shipmentId` param, from a link (`/route?shipmentId=12`) or a deep link
 * (`carabaomerchant://route?shipmentId=12`); null when it is missing or not a positive integer.
 * Same rule as the web routing page's parseShipmentId.
 */
export function parseShipmentId(raw: string | string[] | undefined): number | null {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

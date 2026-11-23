// src/lib/navigation.ts
// S12 (plan §5.4, part 2, decision D1): turn-by-turn links for one stop, copied from the web
// `frontend/carabao-app/util/navigation.ts` (Google Maps and Waze, the two apps the web offers),
// plus the stop-status helpers the routing page reads from the web `util/tracking.ts`. One stop
// per link on purpose: Google caps how many waypoints a directions URL can carry, so a
// whole-route link would silently drop stops on long batches. The query strings are written out
// rather than built with URLSearchParams, whose React Native support has been incomplete.
// `npm test` checks all of it (src/lib/navigation.test.ts).
import { CLOSED_ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from './orderStatus.ts';

const isLatitude = (lat: number) => Number.isFinite(lat) && Math.abs(lat) <= 90;
const isLongitude = (lng: number) => Number.isFinite(lng) && Math.abs(lng) <= 180;

/** True when the pair can be handed to a maps app. */
export function isNavigable(lat: number, lng: number): boolean {
  return isLatitude(lat) && isLongitude(lng);
}

function assertNavigable(lat: number, lng: number): void {
  if (!isNavigable(lat, lng)) {
    throw new RangeError(`Invalid coordinates: ${lat}, ${lng}`);
  }
}

/** Google Maps driving directions from the device's location to the stop. */
export function googleMapsDirectionsUrl(lat: number, lng: number): string {
  assertNavigable(lat, lng);
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

/** Waze navigation to the stop (the web's second app, decision D1). */
export function wazeNavigationUrl(lat: number, lng: number): string {
  assertNavigable(lat, lng);
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}

/** A stop is finished once its order is delivered, cancelled or refunded (the web's rule). */
export const isClosedStatus = (status: string | null | undefined): boolean =>
  !!status && (CLOSED_ORDER_STATUSES as readonly string[]).includes(status);

/** The web's status words; an unknown status is shown readably instead of as snake_case. */
export const statusLabel = (status: string | null | undefined): string =>
  status
    ? ORDER_STATUS_LABELS[status as OrderStatus] ?? status.replaceAll('_', ' ')
    : 'Status unknown';

/** Every stop is closed: nothing left to refresh, so the route screen stops polling. */
export const isRouteFinished = (data: { stops: readonly { status: string }[] }): boolean =>
  data.stops.length > 0 && data.stops.every((stop) => isClosedStatus(stop.status));

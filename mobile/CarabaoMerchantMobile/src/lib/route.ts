// src/lib/route.ts
// S12 (plan §5.4, part 2): the Route screen's words and small formatters. The words are copied
// from the web merchant routing page and its i18n block (`routing` in
// frontend/carabao-app/lib/i18n/strings/en.ts), so a farm reads the same text on the phone as on
// the website; the map's legend is the web RouteMap's. The rules are in routeMap.ts and
// navigation.ts. `npm test` checks this file (src/lib/route.test.ts).

export const ROUTE_TITLE = 'Routing';
export const BACK_TO_SHIPMENTS = 'Back to shipments';
/** The web page's honest note: the order is planned, and nothing here is live GPS. */
export const HONESTY_NOTE =
  'Order of stops optimised with ALNS on road travel times. Positions and arrival times are estimates. There is no live GPS.';
export const STOPS_HEADING = 'Stops';
export const NEXT_STOP = 'Next stop';
export const ALL_DONE = 'All stops are done. This route is no longer refreshing.';
export const NO_ESTIMATE = 'No arrival estimate';
export const ADDRESS_UNAVAILABLE = 'Delivery address unavailable';
export const NAVIGATE = 'Navigate';
export const WAZE = 'Waze';

// The stop's pin report (pin quality, control 6). The note limit is the backend's
// PinUnreachableRequest (200) and the web input's maxLength.
export const REPORT_PIN = 'Cannot get to pin';
export const REPORT_NOTE_LABEL = 'What stopped you? (optional)';
export const REPORT_NOTE_PLACEHOLDER = 'Example: the pin is in a field, no road to the gate';
export const REPORT_NOTE_MAX = 200;
export const REPORT_SEND = 'Send report';
export const REPORT_CANCEL = 'Cancel';
export const REPORTED = 'Pin reported';
export const REPORTED_NOTE = 'You reported this pin. We told the buyer to move it.';
// ORDER_PROOF_PHOTOS_PLAN.md: the stop card's proof photo buttons (merchant app only; the web
// route page has none). A live camera photo; the server keeps the distance to the pin.
export const DELIVERED_PHOTO = 'Delivered – take photo';
export const NOT_HOME_PHOTO = 'Buyer not home – take photo';
export const PROOF_SENDING = 'Sending photo…';
export const PROOF_ERROR = 'The photo could not be sent, so the stop did not change. Try again.';
export const NOT_HOME_CONFIRM =
  'Take a photo at the address. The order is then cancelled and the buyer is refunded.';
export const APPROXIMATE = 'Approximate pin';
export const APPROXIMATE_NOTE =
  'The buyer did not place this pin; it is where their typed address points. Check the address, or message the buyer if you cannot find the place.';
export const VERIFIED = 'Verified pin';
export const VERIFIED_NOTE = 'A rider delivered to this pin before.';
export const NO_ROAD = 'No road near pin';
export const NO_ROAD_NOTE =
  'We found no road near this pin. Message the buyer before you go, or go to the nearest road and call them.';
export const REPORT_ERROR = 'We could not send the report. Try again.';
/** Google Maps or Waze is not installed and no browser would take the link. */
export const LINK_ERROR = 'Could not open the map app. Try again.';

// The route's loading and error states.
export const LOADING_ROUTE = 'Loading route…';
export const NOT_FOUND_TITLE = 'Shipment not found';
export const NOT_FOUND_BODY = "This shipment doesn't exist or belongs to another merchant.";
export const NOT_READY = 'The route for this shipment is not ready yet.';
export const LOAD_ERROR = "We couldn't load this route. Check your connection and try again.";

// The map (web RouteMap legend) and what the phone shows instead of map imagery.
export const MAP_LEGEND_LABEL = 'Map legend';
export const PICKUP_LEGEND = 'Pickup';
export const OTHER_STOPS_LEGEND = 'Other stops';
export const CLOSED_STOPS_LEGEND = 'Delivered or cancelled';
/** Decision D3: Android needs a Google Maps key; without one the list stands in for the map. */
export const ANDROID_MAP_NOTE =
  'Map not available. Android needs a Google Maps key (EXPO_PUBLIC_GOOGLE_MAPS_KEY) to draw the map; the stops and their numbers are listed below.';
export const WEB_MAP_NOTE =
  'Map not available here. The map is drawn in the Android and iOS apps; the stops and their numbers are listed below.';

export const shipmentLabel = (id: number) => `Shipment #${id}`;
export const stopsDoneLabel = (done: number, total: number) => `${done} of ${total} stops done`;
export const plannedDurationLabel = (duration: string) => `Planned drive time ${duration}`;
export const updatedLabel = (time: string) => `Updated ${time}`;
export const plannedArrivalLabel = (time: string) => `Planned arrival ${time}`;
export const stopLabel = (n: number) => `Stop ${n}`;
export const navigateToLabel = (n: number) => `Navigate to stop ${n} in Google Maps`;
export const wazeToLabel = (n: number) => `Navigate to stop ${n} in Waze`;
export const reportPinToLabel = (n: number) => `Report that you cannot get to the pin of stop ${n}`;

/** "45 min" or "1 h 20 min" for the planned drive time, in seconds (never "0 min"). */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/** "Nov 24, 3:05 PM" for a planned arrival; null when there is none or it is unreadable. */
export function formatArrival(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** "3:05 PM" for the last successful refresh; null before the first one. */
export function formatUpdatedAt(at: number | null): string | null {
  if (at === null) return null;
  return new Date(at).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

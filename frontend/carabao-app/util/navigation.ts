// Turn-by-turn links for a single stop. Deliberately one stop per link: Google
// caps how many waypoints a directions URL can carry, so a whole-route link
// would silently drop stops on long batches.

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
  const params = new URLSearchParams({
    api: '1',
    destination: `${lat},${lng}`,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Waze navigation to the stop. */
export function wazeNavigationUrl(lat: number, lng: number): string {
  assertNavigable(lat, lng);
  const params = new URLSearchParams({ ll: `${lat},${lng}`, navigate: 'yes' });
  return `https://waze.com/ul?${params.toString()}`;
}

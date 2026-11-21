// Mapbox geocoding for the map pin (U1b). Forward: the typed address places the
// first pin. Reverse: the pin's area, to check it against the typed address.
// Neither one writes the address fields; the typed address is what riders read.
// Both go through the API (signed in, rate limited, cached), so no Mapbox
// geocoding token is in the browser.

import type { PlaceHints } from '@/lib/pin-area';
import { geocodePlace, reverseGeocodePlace, type PlaceFeature } from '@/util/api/locations';

export type Pin = { lat: number; lng: number };

export type PinAddress = {
  /** Mapbox's full label, shown under the map so the person can check the pin. */
  placeName: string | null;
  /** Mapbox place names at the pin, matched to PSGC names for the area check. */
  hints: PlaceHints;
};

/** A pin placed from the typed address, and how close in to show it. */
export type AddressHit = { pin: Pin; zoom: number; hints: PlaceHints };

const NO_HINTS: PlaceHints = { province: [], city: [], barangay: [] };

type MapboxFeature = PlaceFeature;

/** Province, city and barangay names in a Mapbox feature and its context. */
export function placeHints(feature: MapboxFeature | undefined): PlaceHints {
  if (!feature) return NO_HINTS;
  // In the Philippines Mapbox calls the province "region" (Metro Manila too),
  // the city or municipality "place", and the barangay "locality" or
  // "neighborhood". The feature itself can be one of these.
  const parts = [...(feature.id && feature.text ? [{ id: feature.id, text: feature.text }] : []), ...(feature.context ?? [])];
  const texts = (...types: string[]) =>
    parts.filter((p) => types.some((type) => p.id.startsWith(`${type}.`))).map((p) => p.text);
  return {
    province: texts('region', 'district'),
    city: texts('place'),
    barangay: texts('locality', 'neighborhood'),
  };
}

/** Street-level hits are shown close in; a city-level hit shows the city. */
function zoomFor(feature: MapboxFeature): number {
  const types = feature.place_type ?? [];
  if (types.includes('address') || types.includes('poi')) return 17;
  if (types.includes('neighborhood') || types.includes('locality')) return 15;
  return 13;
}

export async function reverseGeocode(pin: Pin): Promise<PinAddress> {
  const feature = await reverseGeocodePlace(pin);
  return { placeName: feature?.place_name ?? null, hints: placeHints(feature) };
}

/** The best spot for a typed address, or null when Mapbox finds nothing. */
export async function forwardGeocode(query: string): Promise<AddressHit | null> {
  const feature = await geocodePlace(query);
  const center = feature?.center;
  if (!feature || !center) return null;
  return { pin: { lng: center[0], lat: center[1] }, zoom: zoomFor(feature), hints: placeHints(feature) };
}

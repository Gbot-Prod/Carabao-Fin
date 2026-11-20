// Mapbox geocoding for the map pin (U1b). Forward: the typed address places the
// first pin. Reverse: the pin's area, to check it against the typed address.
// Neither one writes the address fields; the typed address is what riders read.

import type { PlaceHints } from '@/lib/pin-area';

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
const BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

type MapboxContext = { id: string; text: string };
type MapboxFeature = {
  id?: string;
  place_type?: string[];
  text?: string;
  place_name?: string;
  center?: [number, number];
  context?: MapboxContext[];
};

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

async function search(path: string, params: string): Promise<MapboxFeature | undefined> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_API_KEY;
  if (!token) return undefined;
  const res = await fetch(`${BASE}/${path}.json?country=PH&limit=1&${params}&access_token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const body = (await res.json()) as { features?: MapboxFeature[] };
  return body.features?.[0];
}

export async function reverseGeocode(pin: Pin): Promise<PinAddress> {
  const feature = await search(`${pin.lng},${pin.lat}`, 'types=address,poi,neighborhood,locality,place');
  return { placeName: feature?.place_name ?? null, hints: placeHints(feature) };
}

/** The best spot for a typed address, or null when Mapbox finds nothing. */
export async function forwardGeocode(query: string): Promise<AddressHit | null> {
  const feature = await search(
    encodeURIComponent(query),
    'types=address,poi,neighborhood,locality,place&autocomplete=false',
  );
  const center = feature?.center;
  if (!feature || !center) return null;
  return { pin: { lng: center[0], lat: center[1] }, zoom: zoomFor(feature), hints: placeHints(feature) };
}

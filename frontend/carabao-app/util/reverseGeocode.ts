// Map pin -> address text (U1b), via Mapbox reverse geocoding.

import type { PlaceHints } from '@/lib/pin-autofill';

export type Pin = { lat: number; lng: number };

export type PinAddress = {
  /** Street line for the "Street / House No." field (house number + street, or the place). */
  street: string | null;
  postcode: string | null;
  /** Mapbox's full label, shown under the map so the buyer can check the pin. */
  placeName: string | null;
  /** Mapbox place names at the pin, for the region/province/city/barangay selects. */
  hints: PlaceHints;
};

const NO_HINTS: PlaceHints = { province: [], city: [], barangay: [] };

type MapboxContext = { id: string; text: string };
type MapboxFeature = {
  id?: string;
  place_type?: string[];
  text?: string;
  address?: string;
  place_name?: string;
  context?: MapboxContext[];
};

/** Pulls the fields we use out of a Mapbox reverse-geocoding feature. */
export function parseReverseGeocode(feature: MapboxFeature | undefined): PinAddress {
  if (!feature) return { street: null, postcode: null, placeName: null, hints: NO_HINTS };
  const context = feature.context ?? [];
  // In the Philippines Mapbox calls the province "region" (Metro Manila too),
  // the city or municipality "place", and the barangay "locality" or
  // "neighborhood". The feature itself can be one of these.
  const parts = [...(feature.id && feature.text ? [{ id: feature.id, text: feature.text }] : []), ...context];
  const texts = (...types: string[]) =>
    parts.filter((p) => types.some((type) => p.id.startsWith(`${type}.`))).map((p) => p.text);
  const hints: PlaceHints = {
    province: texts('region', 'district'),
    city: texts('place'),
    barangay: texts('locality', 'neighborhood'),
  };
  const postcode =
    context.find((c) => c.id.startsWith('postcode'))?.text ??
    (feature.place_type?.includes('postcode') ? feature.text ?? null : null);
  const isStreetLevel = feature.place_type?.some((t) => t === 'address' || t === 'poi') ?? false;
  const street = isStreetLevel
    ? [feature.address, feature.text].filter(Boolean).join(' ') || null
    : null;
  return { street, postcode: postcode ?? null, placeName: feature.place_name ?? null, hints };
}

export async function reverseGeocode(pin: Pin): Promise<PinAddress> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_API_KEY;
  if (!token) return { street: null, postcode: null, placeName: null, hints: NO_HINTS };
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${pin.lng},${pin.lat}.json` +
    `?country=PH&types=address,poi,neighborhood,locality,place,postcode&limit=1&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Reverse geocoding failed (${res.status})`);
  const body = (await res.json()) as { features?: MapboxFeature[] };
  return parseReverseGeocode(body.features?.[0]);
}

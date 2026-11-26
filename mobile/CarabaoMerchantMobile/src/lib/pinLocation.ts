// src/lib/pinLocation.ts
// S13 (plan §5.8): the pure rules behind the address form's map pin, and the form's own field
// checks and words. Three web files are copied here, DOM-free, because src/lib is what the node
// tests can read:
//   * lib/pin-area.ts — typed address <-> pin and PSGC/Mapbox place-name matching, rules verbatim;
//   * util/pinLocation.ts — Mapbox place hints -> PSGC select values (the PSGC requests, below);
//   * util/geocode.ts — placeHints, zoomFor and addressHit. The HTTP calls themselves live in
//     src/lib/api.ts (api.locations) and in src/components/AddressPinMap.tsx, so this file has
//     no React Native imports.
// The typed address is what the rider reads, so the pin never rewrites it: the address places
// the first pin (forward geocoding), and a pin that lands in another city is flagged for the
// person to check. Keep the words in step with the web (inStep.test.ts checks them).
import type { PlaceFeature } from './api.ts';
import {
  fetchAllProvinces,
  fetchBarangaysByCity,
  fetchCitiesByProvince,
  fetchCitiesByRegion,
  fetchRegions,
  isNcrRegionName,
  NCR_CODE,
  type PsgcCity,
  type PsgcProvince,
  type PsgcRegion,
} from './psgc.ts';
import { isLuzonRegion, NCR_PROVINCE, SERVICE_AREA_NOTE } from './serviceArea.ts';

// ── Place names (web lib/pin-area.ts) ─────────────────────────────────────────

export type PlaceKind = 'province' | 'city' | 'barangay';

export type LocationValue = {
  region?: string;
  province?: string;
  city?: string;
  barangay?: string;
};

/** Place names that reverse geocoding found at the pin, most specific first. */
export type PlaceHints = {
  province: string[];
  city: string[];
  barangay: string[];
};

/**
 * Some PSGC names are UTF-8 read as Latin-1 ("Santo NiÃ±o" for "Santo Niño").
 * Undo that for the comparison; the PSGC name itself is kept for the selects.
 * (The web uses TextDecoder; decodeURIComponent is Hermes-safe and just as strict.)
 */
export function repairMojibake(text: string): string {
  if (!/[ÃÂ]/.test(text) || [...text].some((ch) => ch.charCodeAt(0) > 0xff)) return text;
  try {
    const bytes = [...text].map((ch) => ch.charCodeAt(0));
    return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    return text;
  }
}

export function normalizePlace(name: string, kind: PlaceKind): string {
  let text = repairMojibake(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\bsta\b/g, 'santa')
    .replace(/\bsto\b/g, 'santo')
    .replace(/\s+/g, ' ')
    .trim();
  if (kind === 'city') {
    text = text.replace(/^(city|municipality) of /, '').replace(/ city$/, '');
  }
  if (kind === 'barangay') {
    text = text.replace(/^(barangay|brgy|bgy) /, '');
  }
  if (kind === 'province') {
    text = text.replace(/ province$/, '').replace(/^province of /, '');
  }
  return text.trim();
}

/** The option whose name matches one of the candidates, in candidate order. */
export function findPlace<T extends { name: string }>(
  options: readonly T[],
  candidates: readonly string[],
  kind: PlaceKind,
): T | null {
  const byName = new Map<string, T>();
  for (const option of options) {
    const key = normalizePlace(option.name, kind);
    if (key && !byName.has(key)) byName.set(key, option);
  }
  for (const candidate of candidates) {
    const hit = byName.get(normalizePlace(candidate, kind));
    if (hit) return hit;
  }
  return null;
}

/** The typed address, as the forms hold it (PSGC names in the selects). */
export type TypedAddress = LocationValue & { street?: string; postalCode?: string };

/**
 * The map pin opens only once the whole address is filled in (as on Shopee):
 * the pin is placed from it, and the person adjusts from there.
 */
export function addressComplete(address: TypedAddress): boolean {
  return [address.province, address.city, address.barangay, address.postalCode, address.street].every(
    (part) => !!part?.trim(),
  );
}

/** "City of Taguig" -> "Taguig": Mapbox finds the plain name more reliably. */
function plainCity(name: string): string {
  return repairMojibake(name).replace(/^(city|municipality) of /i, '').replace(/\(.*?\)/g, '').trim();
}

/**
 * The search text for placing the first pin from the typed address, or null
 * until a city is picked (a street alone could match anywhere in Luzon).
 * `withStreet: false` drops the street, for when the street search lands
 * outside the picked city.
 */
export function addressQuery(address: TypedAddress, withStreet = true): string | null {
  if (!address.city?.trim()) return null;
  const parts = [
    withStreet ? address.street : '',
    address.barangay ? repairMojibake(address.barangay).replace(/\(.*?\)/g, '') : '',
    plainCity(address.city),
    address.province,
  ];
  return parts.map((p) => p?.trim()).filter(Boolean).join(', ');
}

/** Just the city and province, to show the area when the address itself is not found. */
export function cityQuery(address: TypedAddress): string | null {
  if (!address.city?.trim()) return null;
  return [plainCity(address.city), address.province?.trim()].filter(Boolean).join(', ');
}

/**
 * True when a geocoding hit's city names fit the picked city. No city in the
 * hit counts as a fit, and so does "Manila": PSGC lists Manila's districts
 * (Sampaloc, Tondo...) as the cities, which Mapbox does not name.
 */
export function cityFits(hitCities: readonly string[], typedCity: string | undefined): boolean {
  if (!typedCity?.trim() || !hitCities.length) return true;
  if (hitCities.some((c) => normalizePlace(c, 'city') === 'manila')) return true;
  return findPlace([{ name: typedCity }], hitCities, 'city') !== null;
}

/**
 * Where the pin is, when that is not where the typed address says. Compares
 * the city (or the province when the pin's city is unknown); the barangay is
 * left out because Mapbox's barangay edges are too rough to warn on.
 * Null when they agree or there is too little to compare.
 */
export function pinAreaMismatch(
  pin: LocationValue | null,
  typed: LocationValue,
): { pin: string; typed: string } | null {
  if (!pin?.region) return null;
  if (pin.city && typed.city) {
    const a = normalizePlace(pin.city, 'city');
    const b = normalizePlace(typed.city, 'city');
    // The pin resolves to the whole City of Manila when its barangay is not found.
    if (a === b || a === 'manila' || b === 'manila') return null;
    return { pin: pin.city, typed: typed.city };
  }
  if (pin.province && typed.province && normalizePlace(pin.province, 'province') !== normalizePlace(typed.province, 'province')) {
    return { pin: pin.province, typed: typed.province };
  }
  return null;
}

// ── The pin and geocoding hits (web util/geocode.ts) ──────────────────────────

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

/** Province, city and barangay names in a Mapbox feature and its context. */
export function placeHints(feature: PlaceFeature | null | undefined): PlaceHints {
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
export function zoomFor(feature: PlaceFeature): number {
  const types = feature.place_type ?? [];
  if (types.includes('address') || types.includes('poi')) return 17;
  if (types.includes('neighborhood') || types.includes('locality')) return 15;
  return 13;
}

/** The best spot for a geocoding answer, or null when it has no center. */
export function addressHit(feature: PlaceFeature | null | undefined): AddressHit | null {
  const center = feature?.center;
  if (!feature || !center) return null;
  return { pin: { lng: center[0], lat: center[1] }, zoom: zoomFor(feature), hints: placeHints(feature) };
}

/** Metro Manila, the default view before anything is pinned (web MapPinPicker). */
export const DEFAULT_PIN_CENTER: Pin = { lat: 14.5995, lng: 120.9842 };
export const DEFAULT_PIN_ZOOM = 11;
/** A pin looks the same to a person when it moved less than this. */
export const PIN_SAME_EPSILON = 1e-7;
export const samePin = (a: Pin | null, b: Pin | null) =>
  !!a && !!b && Math.abs(a.lat - b.lat) < PIN_SAME_EPSILON && Math.abs(a.lng - b.lng) < PIN_SAME_EPSILON;
// The road marker is shown only when the road point is this far from the pin.
export const ROAD_MARKER_MIN_M = 5;
// Wait for typing to settle before placing the pin from the address.
export const ADDRESS_DEBOUNCE_MS = 700;
// Copied from the web MapPinPicker: the pin, and the rider's stop on the road.
export const PIN_COLOR = '#277a4d';
export const ROAD_COLOR = '#173d25';

// ── Place hints -> PSGC names (web util/pinLocation.ts) ───────────────────────

/** A real city first: Manila's districts (Sampaloc, Tondo...) are listed as cities too. */
const findCity = (cities: PsgcCity[], hints: string[]) =>
  findPlace(cities.filter((c) => c.type !== 'SubMun'), hints, 'city') ?? findPlace(cities, hints, 'city');

/**
 * The barangay, and the city that holds it. PSGC puts the City of Manila's
 * barangays under its districts, not under the city, so for Manila the
 * district becomes the city (as when a person picks it in the selects).
 */
async function findBarangay(city: PsgcCity, cities: PsgcCity[], hints: string[]) {
  if (!hints.length) return null;
  const own = await fetchBarangaysByCity(city.code);
  if (own.length) {
    const barangay = findPlace(own, hints, 'barangay');
    return barangay ? { city, barangay } : null;
  }
  const prefix = city.code.slice(0, 6);
  const districts = cities.filter((c) => c.type === 'SubMun' && c.code.startsWith(prefix));
  const lists = await Promise.all(districts.map((d) => fetchBarangaysByCity(d.code).catch(() => [])));
  for (const [index, list] of lists.entries()) {
    const barangay = findPlace(list, hints, 'barangay');
    if (barangay) return { city: districts[index], barangay };
  }
  return null;
}

/**
 * The deepest select values the hints resolve to, or null when not even the
 * region is found (or it is not served, which the selects do not offer).
 * Never throws: a PSGC outage only means no autofill. NCR answers with
 * "Metro Manila" as its province (plan §2.2).
 */
export async function resolvePinLocation(hints: PlaceHints): Promise<LocationValue | null> {
  try {
    const regions = (await fetchRegions()).filter((r) => isLuzonRegion(r.name));
    const saysNcr = hints.province.some((name) => isNcrRegionName(name));

    let region: PsgcRegion | undefined;
    let province: PsgcProvince | null = null;
    if (!saysNcr && hints.province.length) {
      const provinces = (await fetchAllProvinces()).filter((p) => p.region && isLuzonRegion(p.region));
      province = findPlace(provinces, hints.province, 'province');
      region = province ? regions.find((r) => r.name === province!.region) : undefined;
      if (!region) return null; // a province we do not serve
    }

    let cities: PsgcCity[];
    if (region && province) {
      cities = await fetchCitiesByProvince(region.code, province.code);
    } else {
      // Metro Manila: Mapbox gives the city ("Makati") and no province.
      region = regions.find((r) => r.code === NCR_CODE);
      if (!region) return null;
      cities = await fetchCitiesByRegion(region.code);
      if (!saysNcr && !findCity(cities, hints.city)) return null;
    }

    const result: LocationValue = { region: region.name, province: province?.name ?? NCR_PROVINCE };
    const city = findCity(cities, hints.city);
    if (!city) return result;
    result.city = city.name;

    const found = await findBarangay(city, cities, hints.barangay);
    if (found) {
      result.city = found.city.name;
      result.barangay = found.barangay.name;
    }
    return result;
  } catch {
    return null;
  }
}

// ── The address form's values, checks and words (S13) ────────────────────────

/**
 * What the form holds. The selects carry PSGC names; NCR's province is
 * "Metro Manila" (psgc.provinceForRegion). `latitude`/`longitude` are the pin;
 * `pin_confirmed` says the person placed or confirmed it, so a pin suggested
 * from the address is not saved as if it were checked (web StoreDetails).
 */
export type AddressValue = {
  region: string;
  province: string;
  city: string;
  barangay: string;
  postal_code: string;
  street: string;
  latitude: number | null;
  longitude: number | null;
  pin_confirmed: boolean;
};

export const EMPTY_ADDRESS: AddressValue = {
  region: '',
  province: '',
  city: '',
  barangay: '',
  postal_code: '',
  street: '',
  latitude: null,
  longitude: null,
  pin_confirmed: false,
};

/** A field's message under that field; the keys match the backend's field names. */
export type AddressField = 'region' | 'province' | 'city' | 'barangay' | 'address' | 'postal_code' | 'pin';
export type AddressErrors = Partial<Record<AddressField, string>>;

/**
 * The lengths the backend accepts (backend/app/schemas/merchant.py MerchantUpdate)
 * and the web inputs stop at. `street` is the backend's `address`.
 */
export const ADDRESS_MAX = {
  region: 100,
  province: 100,
  city: 100,
  barangay: 100,
  street: 500,
  postal_code: 10,
} as const;

/** The four select labels and their placeholders (web lib/i18n/strings/en.ts location). */
export const LOCATION_WORDS = {
  region: 'Region',
  province: 'Province',
  city: 'City',
  barangay: 'Barangay',
  loading: 'Loading…',
  selectRegion: 'Select region',
  selectRegionFirst: 'Select a region first',
  selectProvince: 'Select province',
  selectProvinceFirst: 'Select a province first',
  selectCity: 'Select city',
  selectCityFirst: 'Select a city first',
  selectBarangay: 'Select barangay',
  serviceAreaNote: SERVICE_AREA_NOTE,
} as const;

/** The map pin's words (web lib/i18n/strings/en.ts mapPin). */
export const PIN_WORDS = {
  label: 'Pin your location on the map',
  noticeTitle: 'Place an accurate pin',
  noticeBody: 'Riders go to your map pin, not to the address text. Make sure that the pin is at your gate or door. If it is not, tap the map or drag the pin to move it.',
  useMyLocation: 'Use my location',
  locating: 'Finding you…',
  mapLabel: 'Map: click or drag the pin to your location',
  hint: 'Finding your address on the map…',
  notFound: 'We could not find this exact address on the map. Click the map at your gate or door to place your pin.',
  pinRequired: 'Place your pin on the map at your gate or door.',
  locked: 'Fill in the full address above (region to street) to place your pin on the map.',
  fromAddress: 'We suggested this pin from your address. Drag it or click the map to put it at your gate or door, or confirm it if it is already right.',
  confirmPin: 'This pin is correct',
  confirmNeeded: 'Move the pin to your gate or door, or tap “This pin is correct”.',
  mismatch: 'Your pin looks like it is in {pin}, but your address says {typed}. Check the pin or the address.',
  pinned: 'Pin saved for delivery routing.',
  unavailable: 'The map is not available right now, so a pin cannot be placed. Please try again in a few minutes.',
  checking: 'Looking for a road near the pin…',
  onRoad: 'Your pin is on a road. The rider stops here.',
  roadNote: 'The rider stops at the dark marker, on the nearest road ({m} m from your pin).',
  roadMarker: 'The rider stops here',
  noRoad: 'There is no road near this pin. Move the pin to your gate or to the street where the rider can stop.',
  reported: 'A rider could not get to this place on an earlier order. Make sure that the pin is at your gate.',
  blocked: 'Riders could not get to this pin on earlier orders. Move the pin to a gate or road that a rider can get to.',
} as const;

/** The street and postal inputs' labels and hints (web StoreDetails.tsx). */
export const ADDRESS_LABELS = {
  postalCode: 'Postal Code',
  postalPlaceholder: 'e.g. 2600',
  street: 'Street / House No.',
  streetPlaceholder: 'e.g. 123 Rizal St., Unit 4B',
} as const;

/** The form's own messages, the same words the web onboarding uses for these fields. */
export const ADDRESS_MESSAGES = {
  region: 'Select your region.',
  province: 'Select your province.',
  city: 'Select your city / municipality.',
  barangay: 'Select your barangay.',
  postal_code: 'Postal code is required.',
  address: 'Enter your street / house no.',
  pin: PIN_WORDS.pinRequired,
  pinUnconfirmed: PIN_WORDS.confirmNeeded,
} as const;

/** "Your pin looks like it is in X, but your address says Y..." with the two names filled in. */
export const pinMismatchText = (mismatch: { pin: string; typed: string }): string =>
  PIN_WORDS.mismatch.replace('{pin}', mismatch.pin).replace('{typed}', mismatch.typed);

/** "The rider stops at the dark marker, on the nearest road (N m from your pin)." */
export const roadNoteText = (meters: number): string =>
  PIN_WORDS.roadNote.replace('{m}', String(Math.round(meters)));

/**
 * Every problem in the address, keyed like the backend's fields, so a screen can show the
 * server's own messages in the same places. A farm needs a pin (deliveries start there), and
 * a suggested pin counts only once confirmed (plan §2.2, web onboarding validateStep).
 */
export function checkAddress(
  value: AddressValue,
  options: { requirePin?: boolean } = {},
): AddressErrors {
  const errors: AddressErrors = {};
  if (!value.street.trim()) errors.address = ADDRESS_MESSAGES.address;
  if (!value.region.trim()) errors.region = ADDRESS_MESSAGES.region;
  else if (!value.province.trim() && !isNcrRegionName(value.region)) errors.province = ADDRESS_MESSAGES.province;
  if (value.region.trim() && !value.city.trim()) errors.city = ADDRESS_MESSAGES.city;
  if (value.city.trim() && !value.barangay.trim()) errors.barangay = ADDRESS_MESSAGES.barangay;
  if (!value.postal_code.trim()) errors.postal_code = ADDRESS_MESSAGES.postal_code;
  if (options.requirePin !== false) {
    if (value.latitude == null || value.longitude == null) errors.pin = ADDRESS_MESSAGES.pin;
    else if (!value.pin_confirmed) errors.pin = ADDRESS_MESSAGES.pinUnconfirmed;
  }
  return errors;
}

/** The address half of a merchant update, as the web StoreDetails sends it. */
export type AddressPayload = {
  region: string;
  province: string;
  city: string;
  barangay: string;
  address: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  pin_confirmed: boolean;
};

/**
 * The saves: trimmed fields, the NCR province filled in when a saved address left it blank, and
 * the pin only once confirmed (a suggested pin is not a checked one). The backend names the
 * street `address`; callers spread this into UPDATE /merchant-onboarding payloads.
 */
export function addressPayload(value: AddressValue): AddressPayload {
  const pinned = value.pin_confirmed && value.latitude != null && value.longitude != null;
  return {
    region: value.region.trim(),
    province: value.province.trim() || (isNcrRegionName(value.region) ? NCR_PROVINCE : ''),
    city: value.city.trim(),
    barangay: value.barangay.trim(),
    address: value.street.trim(),
    postal_code: value.postal_code.trim(),
    latitude: pinned ? value.latitude : null,
    longitude: pinned ? value.longitude : null,
    pin_confirmed: pinned,
  };
}

// Decision D3, for this map: without a key a Google map cannot be drawn to place the pin on.
export const PIN_MAP_KEY_NOTE =
  'Map not available. The app needs a Google Maps key (EXPO_PUBLIC_GOOGLE_MAPS_KEY) to place the pin; add the key and rebuild the app, or set the pin on the web.';
export const WEB_PIN_MAP_NOTE =
  'Map not available in the browser preview. Place the pin in the Android or iOS app.';

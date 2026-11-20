// Typed address <-> map pin. The typed address is what the rider reads, so the
// pin never rewrites it: the address places the first pin (forward geocoding),
// and a pin that lands in another city is flagged for the person to check.
// Pure helpers; util/pinLocation.ts does the PSGC requests. Mapbox and PSGC write the same place differently
// ("Malolos City" / "City of Malolos ", "Las Pinas" / "City of Las Piñas"),
// so names are compared in a normal form, and the PSGC name is returned as it
// is, because the location selects match on the exact PSGC name.

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
 */
export function repairMojibake(text: string): string {
  if (!/[ÃÂ]/.test(text) || [...text].some((ch) => ch.charCodeAt(0) > 0xff)) return text;
  try {
    const bytes = Uint8Array.from([...text].map((ch) => ch.charCodeAt(0)));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

export function normalizePlace(name: string, kind: PlaceKind): string {
  let text = repairMojibake(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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

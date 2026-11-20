// Map pin -> address fields (pin autofill). Pure helpers; util/pinLocation.ts
// does the PSGC requests. Mapbox and PSGC write the same place differently
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

/**
 * The pin is the newest input, so what it resolves replaces the selects.
 * A level the pin could not resolve keeps its value only while the levels
 * above it did not change.
 */
export function mergeLocation(current: LocationValue, resolved: LocationValue | null): LocationValue {
  if (!resolved?.region) return current;
  const sameRegion = resolved.region === current.region;
  const province = resolved.province || (sameRegion ? current.province ?? '' : '');
  const sameProvince = sameRegion && province === current.province;
  const city = resolved.city || (sameProvince ? current.city ?? '' : '');
  const sameCity = sameProvince && city === current.city;
  const barangay = resolved.barangay || (sameCity ? current.barangay ?? '' : '');
  return { region: resolved.region, province, city, barangay };
}

/**
 * A free-text field (street, postal code): fill it when it is empty or still
 * holds the previous autofill; keep what the person typed.
 */
export function fillText(current: string, next: string | null | undefined, lastAuto: string | null): string {
  if (!next) return current;
  if (!current.trim() || current === lastAuto) return next;
  return current;
}

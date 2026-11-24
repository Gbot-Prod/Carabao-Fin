// src/lib/psgc.ts
// S13 (plan §5.8): the four PSGC lists the address form's selects read, and the names the pin
// autofill matches Mapbox's place names against. Copied from the web app
// (frontend/carabao-app/util/psgc.ts) so both clients ask the same API for the same names.
// Two changes: a request timeout (a phone on a slow network should not wait forever) and
// provinceForRegion, which is where the app names NCR's missing province "Metro Manila".
// Keep the base URL in step with the web (inStep.test.ts checks it).
import { NCR_PROVINCE } from './serviceArea.ts';

export type PsgcRegion = { code: string; name: string };
export type PsgcProvince = { code: string; name: string; region?: string };
/** type: City, Mun, or SubMun (Manila's districts). */
export type PsgcCity = { code: string; name: string; type?: string };
export type PsgcBarangay = { code: string; name: string };

type PsgcResponse<T> = {
  data: T[];
};

/** The public PSGC API, the same one the web app reads. */
export const PSGC_BASE = 'https://psgc.cloud/api/v2';

/** The PSGC code of the National Capital Region (the web's LocationSelects has the same). */
export const NCR_CODE = '1300000000';

// Names the PSGC and Mapbox use for NCR, in the normal form they are compared in.
const NCR_NAMES = ['ncr', 'national capital region', 'metro manila'];

// A list the screen is waiting on; long enough for mobile data, short enough to retry.
const REQUEST_TIMEOUT_MS = 15000;

// One request per list per app visit: the selects and the pin autofill ask for the same lists.
// A failed request is dropped, so the next ask retries.
const cache = new Map<string, Promise<unknown>>();

async function fetchList<T>(url: string, error: string): Promise<T[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(error);
    const { data } = (await res.json()) as PsgcResponse<T & { name: string }>;
    return data.sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    clearTimeout(timer);
  }
}

function cached<T>(url: string, error: string): Promise<T[]> {
  const hit = cache.get(url) as Promise<T[]> | undefined;
  if (hit) return hit;
  const request = fetchList<T>(url, error);
  cache.set(url, request);
  request.catch(() => cache.delete(url));
  return request;
}

export const fetchRegions = (): Promise<PsgcRegion[]> =>
  cached(`${PSGC_BASE}/regions/`, 'Failed to fetch regions');

/** Every province, each with its region's name. */
export const fetchAllProvinces = (): Promise<PsgcProvince[]> =>
  cached(`${PSGC_BASE}/provinces/`, 'Failed to fetch provinces');

export const fetchProvincesByRegion = (region: string): Promise<PsgcProvince[]> =>
  cached(`${PSGC_BASE}/regions/${region}/provinces/`, 'Failed to fetch provinces');

export const fetchCitiesByRegion = (region: string): Promise<PsgcCity[]> =>
  cached(`${PSGC_BASE}/regions/${region}/cities-municipalities/`, 'Failed to fetch cities');

export const fetchCitiesByProvince = (region: string, province: string): Promise<PsgcCity[]> =>
  cached(`${PSGC_BASE}/regions/${region}/provinces/${province}/cities-municipalities/`, 'Failed to fetch cities');

export const fetchBarangaysByCity = (city: string): Promise<PsgcBarangay[]> =>
  cached(`${PSGC_BASE}/cities-municipalities/${city}/barangays/`, 'Failed to fetch barangays');

/**
 * True for the names the PSGC and Mapbox use for the National Capital Region. A parenthetical
 * note is dropped first: the web's selects save the PSGC's "National Capital Region", while a
 * Google or Mapbox answer may add "(NCR)".
 */
export const isNcrRegionName = (region: string | null | undefined): boolean => {
  if (!region) return false;
  const name = region.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim();
  return NCR_NAMES.includes(name);
};

/**
 * The province a region saves: NCR has no provinces in the PSGC, so the site shows and saves
 * "Metro Manila" (plan §2.2, site standard) and every other region leaves the select to the
 * person. The code answers for a picked region; the name, for a saved one.
 */
export function provinceForRegion(regionCode?: string, regionName?: string): string {
  return regionCode === NCR_CODE || isNcrRegionName(regionName) ? NCR_PROVINCE : '';
}

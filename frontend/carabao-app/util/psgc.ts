export type PsgcRegion = { code: string; name: string };
export type PsgcProvince = { code: string; name: string; region?: string };
/** type: City, Mun, or SubMun (Manila's districts). */
export type PsgcCity = { code: string; name: string; type?: string };
export type PsgcBarangay = { code: string; name: string };

type PsgcResponse<T> = {
  data: T[];
};

// One request per list per page load: the selects and the map-pin autofill
// ask for the same lists. A failed request is dropped, so the next ask retries.
const cache = new Map<string, Promise<unknown>>();

function cached<T>(url: string, error: string): Promise<T[]> {
  const hit = cache.get(url) as Promise<T[]> | undefined;
  if (hit) return hit;
  const request = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(error);
    const { data } = await res.json() as PsgcResponse<T & { name: string }>;
    return data.sort((a, b) => a.name.localeCompare(b.name));
  })();
  cache.set(url, request);
  request.catch(() => cache.delete(url));
  return request;
}

const BASE = 'https://psgc.cloud/api/v2';

export const fetchRegions = (): Promise<PsgcRegion[]> =>
  cached(`${BASE}/regions/`, 'Failed to fetch regions');

/** Every province, each with its region's name. */
export const fetchAllProvinces = (): Promise<PsgcProvince[]> =>
  cached(`${BASE}/provinces/`, 'Failed to fetch provinces');

export const fetchProvincesByRegion = (region: string): Promise<PsgcProvince[]> =>
  cached(`${BASE}/regions/${region}/provinces/`, 'Failed to fetch provinces');

export const fetchCitiesByRegion = (region: string): Promise<PsgcCity[]> =>
  cached(`${BASE}/regions/${region}/cities-municipalities/`, 'Failed to fetch cities');

export const fetchCitiesByProvince = (region: string, province: string): Promise<PsgcCity[]> =>
  cached(`${BASE}/regions/${region}/provinces/${province}/cities-municipalities/`, 'Failed to fetch cities');

export const fetchBarangaysByCity = (city: string): Promise<PsgcBarangay[]> =>
  cached(`${BASE}/cities-municipalities/${city}/barangays/`, 'Failed to fetch barangays');

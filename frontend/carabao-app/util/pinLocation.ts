// Map pin -> region/province/city/barangay select values (pin autofill).
// Turns Mapbox's place names into the exact PSGC names the selects use.

import { findPlace, type LocationValue, type PlaceHints } from '@/lib/pin-area';
import {
  fetchAllProvinces,
  fetchBarangaysByCity,
  fetchCitiesByProvince,
  fetchCitiesByRegion,
  fetchRegions,
  type PsgcCity,
  type PsgcProvince,
  type PsgcRegion,
} from '@/util/psgc';
import { isLuzonRegion, NCR_PROVINCE } from '@/util/serviceArea';

const NCR_CODE = '1300000000';
const NCR_NAMES = ['metro manila', 'ncr', 'national capital region'];

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
 * Never throws: a PSGC outage only means no autofill.
 */
export async function resolvePinLocation(hints: PlaceHints): Promise<LocationValue | null> {
  try {
    const regions = (await fetchRegions()).filter((r) => isLuzonRegion(r.name));
    const saysNcr = hints.province.some((name) => NCR_NAMES.includes(name.trim().toLowerCase()));

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

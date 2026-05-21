export type PsgcRegion = { code: string; name: string };
export type PsgcCity = { code: string; name: string };

const BASE = 'https://psgc.cloud/api';

export const fetchRegions = async (): Promise<PsgcRegion[]> => {
  const res = await fetch(`${BASE}/regions/`);
  if (!res.ok) throw new Error('Failed to fetch regions');
  const data = await res.json() as PsgcRegion[];
  return data.sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchCitiesByRegion = async (regionCode: string): Promise<PsgcCity[]> => {
  const res = await fetch(`${BASE}/regions/${regionCode}/cities-municipalities/`);
  if (!res.ok) throw new Error('Failed to fetch cities');
  const data = await res.json() as PsgcCity[];
  return data.sort((a, b) => a.name.localeCompare(b.name));
};

export type PsgcProvince = { code: string; name: string };

export const fetchProvincesByRegion = async (regionCode: string): Promise<PsgcProvince[]> => {
  const res = await fetch(`${BASE}/regions/${regionCode}/provinces/`);
  if (!res.ok) throw new Error('Failed to fetch provinces');
  const data = await res.json() as PsgcProvince[];
  return data.sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchCitiesByProvince = async (provinceCode: string): Promise<PsgcCity[]> => {
  const res = await fetch(`${BASE}/provinces/${provinceCode}/cities-municipalities/`);
  if (!res.ok) throw new Error('Failed to fetch cities for province');
  const data = await res.json() as PsgcCity[];
  return data.sort((a, b) => a.name.localeCompare(b.name));
};

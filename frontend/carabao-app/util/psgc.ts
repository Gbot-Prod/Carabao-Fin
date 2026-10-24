export type PsgcRegion = { code: string; name: string };
export type PsgcProvince = { code: string; name: string };
export type PsgcCity = { code: string; name: string };
export type PsgcBarangay = { code: string; name: string };

type PsgcResponse<T> = {
  data: T[];
};

export const fetchRegions = async (): Promise<PsgcRegion[]> => {
  const res = await fetch(`https://psgc.cloud/api/v2/regions/`);
  if (!res.ok) throw new Error('Failed to fetch regions');
  const { data } = await res.json() as PsgcResponse<PsgcRegion>;
  return data.sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchProvincesByRegion = async (region: string): Promise<PsgcProvince[]> => {
  const res = await fetch(`https://psgc.cloud/api/v2/regions/${region}/provinces/`);
  if (!res.ok) throw new Error('Failed to fetch provinces');
  const { data } = await res.json() as PsgcResponse<PsgcProvince>;
  return data.sort((a, b) => a.name.localeCompare(b.name));
}

export const fetchCitiesByRegion = async (region: string): Promise<PsgcCity[]> => {
  const res = await fetch(`https://psgc.cloud/api/v2/regions/${region}/cities-municipalities/`);
  if (!res.ok) throw new Error('Failed to fetch cities');
  const { data } = await res.json() as PsgcResponse<PsgcCity>;
  return data.sort((a, b) => a.name.localeCompare(b.name));
}

export const fetchCitiesByProvince = async (region: string, province: string): Promise<PsgcCity[]> => {
  const res = await fetch(`https://psgc.cloud/api/v2/regions/${region}/provinces/${province}/cities-municipalities/`);
  if (!res.ok) throw new Error('Failed to fetch cities');
  const { data } = await res.json() as PsgcResponse<PsgcCity>;
  return data.sort((a, b) => a.name.localeCompare(b.name));
};

export const fetchBarangaysByCity = async (city: string): Promise<PsgcBarangay[]> => {
  const res = await fetch(`https://psgc.cloud/api/v2/cities-municipalities/${city}/barangays/`);
  if (!res.ok) throw new Error('Failed to fetch barangays');
  const { data } = await res.json() as PsgcResponse<PsgcBarangay>;
  return data.sort((a, b) => a.name.localeCompare(b.name));
}



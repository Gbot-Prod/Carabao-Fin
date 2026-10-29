'use client';

import { useEffect, useState } from 'react';
import { fetchRegions, fetchProvincesByRegion, fetchCitiesByProvince, fetchBarangaysByCity, fetchCitiesByRegion } from '@/util/psgc';
import type { PsgcRegion, PsgcProvince, PsgcCity, PsgcBarangay } from '@/util/psgc';

export type LocationSelectsValue = {
  region?: string;
  province?: string;
  city?: string;
  barangay?: string;
};
interface LocationSelectsProps {
  value: LocationSelectsValue;
  onChange: (value: LocationSelectsValue) => void;
  selectClassName?: string;
  labelClassName?: string;
  wrapClassName?: string;
  selectStyle?: React.CSSProperties;
  labelStyle?: React.CSSProperties;
  wrapStyle?: React.CSSProperties;
}

const NCR_CODE = '1300000000';

/**
 * Loads PSGC options for `key`, dropping responses for keys that are no longer
 * current. A null key means the parent selection is missing, so no options.
 */
function usePsgcOptions<T>(key: string | null, load: () => Promise<T[]>) {
  const [loaded, setLoaded] = useState<{ key: string | null; options: T[] }>({ key: null, options: [] });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    load()
      .catch(() => [] as T[])
      .then((options) => {
        if (!cancelled) setLoaded({ key, options });
      });
    return () => {
      cancelled = true;
    };
    // `load` is derived from `key`, so the key alone identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const isCurrent = key !== null && loaded.key === key;
  return { options: isCurrent ? loaded.options : [], loading: key !== null && !isCurrent };
}

export default function LocationSelects({
  value,
  onChange,
  selectClassName = '',
  labelClassName = '',
  wrapClassName = '',
  selectStyle,
  labelStyle,
  wrapStyle,
}: LocationSelectsProps) {
  const { options: regions, loading: loadingRegions } = usePsgcOptions<PsgcRegion>('regions', fetchRegions);
  const selectedRegion = regions.find((region) => region.name === value.region);
  const regionCode = selectedRegion?.code;
  const isNcr = regionCode === NCR_CODE;

  const { options: provinces, loading: loadingProvinces } = usePsgcOptions<PsgcProvince>(
    regionCode && !isNcr ? `provinces:${regionCode}` : null,
    () => fetchProvincesByRegion(regionCode!),
  );
  const selectedProvince = provinces.find((province) => province.name === value.province);
  const provinceCode = selectedProvince?.code;

  // NCR has no provinces, so its cities hang directly off the region.
  const { options: cities, loading: loadingCities } = usePsgcOptions<PsgcCity>(
    isNcr ? `cities:${regionCode}` : regionCode && provinceCode ? `cities:${regionCode}:${provinceCode}` : null,
    () => (isNcr ? fetchCitiesByRegion(regionCode!) : fetchCitiesByProvince(regionCode!, provinceCode!)),
  );
  const selectedCity = cities.find((city) => city.name === value.city);
  const cityCode = selectedCity?.code;

  const { options: barangays, loading: loadingBarangays } = usePsgcOptions<PsgcBarangay>(
    cityCode ? `barangays:${cityCode}` : null,
    () => fetchBarangaysByCity(cityCode!),
  );
  const selectedBarangay = barangays.find((barangay) => barangay.name === value.barangay);

  const handleRegionChange = (code: string) => {
    const region = regions.find((item) => item.code === code);
    onChange({ region: region?.name ?? '', province: '', city: '', barangay: '' });
  };

  const handleProvinceChange = (code: string) => {
    const province = provinces.find((item) => item.code === code);
    onChange({ region: value.region, province: province?.name ?? '', city: '', barangay: '' });
  };

  const handleCityChange = (code: string) => {
    const city = cities.find((item) => item.code === code);
    onChange({ region: value.region, province: value.province, city: city?.name ?? '', barangay: '' });
  };

  const handleBarangayChange = (code: string) => {
    const barangay = barangays.find((item) => item.code === code);
    onChange({ region: value.region, province: value.province, city: value.city, barangay: barangay?.name ?? '' });
  };

  return (
    <>
      <div className={wrapClassName} style={wrapStyle}>
        <label className={labelClassName} style={labelStyle}>Region</label>

        <select
          className={selectClassName}
          style={selectStyle}
          value={selectedRegion?.code ?? ''}
          onChange={(e) => handleRegionChange(e.target.value)}
          disabled={loadingRegions}
        >
          <option value="">{loadingRegions ? 'Loading…' : 'Select region'}</option>
          {regions.map((region) => (
            <option key={region.code} value={region.code}>{region.name}</option>
          ))}
        </select>
      </div>

      <div className={wrapClassName} style={wrapStyle}>
        <label className={labelClassName} style={labelStyle}>Province</label>
        <select
          className={selectClassName}
          style={selectStyle}
          value={selectedProvince?.code ?? ''}
          onChange={(e) => handleProvinceChange(e.target.value)}
          disabled={!value.region || isNcr || loadingProvinces}
        >
          <option value="">
            {!value.region ? 'Select a region first' : isNcr ? 'Not applicable for NCR' : loadingProvinces ? 'Loading…' : 'Select province'}
          </option>
          {provinces.map((province) => (
            <option key={province.code} value={province.code}>{province.name}</option>
          ))}
        </select>
      </div>

      <div className={wrapClassName} style={wrapStyle}>
        <label className={labelClassName} style={labelStyle}>City</label>
        <select
          className={selectClassName}
          style={selectStyle}
          value={selectedCity?.code ?? ''}
          onChange={(e) => handleCityChange(e.target.value)}
          disabled={!value.region || (!isNcr && !value.province) || loadingCities}
        >
          <option value="">
            {!value.region ? 'Select a region first' : !isNcr && !value.province ? 'Select a province first' : loadingCities ? 'Loading…' : 'Select city'}
          </option>
          {cities.map((city) => (
            <option key={city.code} value={city.code}>{city.name}</option>
          ))}
        </select>
      </div>

      <div className={wrapClassName} style={wrapStyle}>
        <label className={labelClassName} style={labelStyle}>Barangay</label>
        <select
          className={selectClassName}
          style={selectStyle}
          value={selectedBarangay?.code ?? ''}
          onChange={(e) => handleBarangayChange(e.target.value)}
          disabled={!value.city || loadingBarangays}
        >
          <option value="">
            {!value.city ? 'Select a city first' : loadingBarangays ? 'Loading…' : 'Select barangay'}
          </option>
          {barangays.map((barangay) => (
            <option key={barangay.code} value={barangay.code}>{barangay.name}</option>
          ))}
        </select>
      </div>
    </>
  );
}

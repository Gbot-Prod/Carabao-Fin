'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { fetchRegions, fetchProvincesByRegion, fetchCitiesByProvince, fetchBarangaysByCity, fetchCitiesByRegion } from '@/util/psgc';
import type { PsgcRegion, PsgcProvince, PsgcCity, PsgcBarangay } from '@/util/psgc';
import { isLuzonRegion } from '@/util/serviceArea';
import { useLanguage } from '@/lib/i18n/LanguageProvider';

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
  const { t } = useLanguage();
  // Q2b: ids per instance, so two pickers on one page don't collide.
  const uid = useId();
  const { options: allRegions, loading: loadingRegions } = usePsgcOptions<PsgcRegion>('regions', fetchRegions);
  // Only Luzon regions can be picked (B2); a saved region outside Luzon simply shows as unselected.
  const regions = useMemo(() => allRegions.filter((region) => isLuzonRegion(region.name)), [allRegions]);
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
        <label htmlFor={`${uid}-region`} className={labelClassName} style={labelStyle}>{t.location.region}</label>

        <select id={`${uid}-region`}
          className={selectClassName}
          style={selectStyle}
          value={selectedRegion?.code ?? ''}
          onChange={(e) => handleRegionChange(e.target.value)}
          disabled={loadingRegions}
        >
          <option value="">{loadingRegions ? t.location.loading : t.location.selectRegion}</option>
          {regions.map((region) => (
            <option key={region.code} value={region.code}>{region.name}</option>
          ))}
        </select>
        <small style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--text-subtle)' }}>{t.location.serviceAreaNote}</small>
      </div>

      <div className={wrapClassName} style={wrapStyle}>
        <label htmlFor={`${uid}-province`} className={labelClassName} style={labelStyle}>{t.location.province}</label>
        <select id={`${uid}-province`}
          className={selectClassName}
          style={selectStyle}
          value={selectedProvince?.code ?? ''}
          onChange={(e) => handleProvinceChange(e.target.value)}
          disabled={!value.region || isNcr || loadingProvinces}
        >
          <option value="">
            {!value.region ? t.location.selectRegionFirst : isNcr ? t.location.notApplicableNcr : loadingProvinces ? t.location.loading : t.location.selectProvince}
          </option>
          {provinces.map((province) => (
            <option key={province.code} value={province.code}>{province.name}</option>
          ))}
        </select>
      </div>

      <div className={wrapClassName} style={wrapStyle}>
        <label htmlFor={`${uid}-city`} className={labelClassName} style={labelStyle}>{t.location.city}</label>
        <select id={`${uid}-city`}
          className={selectClassName}
          style={selectStyle}
          value={selectedCity?.code ?? ''}
          onChange={(e) => handleCityChange(e.target.value)}
          disabled={!value.region || (!isNcr && !value.province) || loadingCities}
        >
          <option value="">
            {!value.region ? t.location.selectRegionFirst : !isNcr && !value.province ? t.location.selectProvinceFirst : loadingCities ? t.location.loading : t.location.selectCity}
          </option>
          {cities.map((city) => (
            <option key={city.code} value={city.code}>{city.name}</option>
          ))}
        </select>
      </div>

      <div className={wrapClassName} style={wrapStyle}>
        <label htmlFor={`${uid}-barangay`} className={labelClassName} style={labelStyle}>{t.location.barangay}</label>
        <select id={`${uid}-barangay`}
          className={selectClassName}
          style={selectStyle}
          value={selectedBarangay?.code ?? ''}
          onChange={(e) => handleBarangayChange(e.target.value)}
          disabled={!value.city || loadingBarangays}
        >
          <option value="">
            {!value.city ? t.location.selectCityFirst : loadingBarangays ? t.location.loading : t.location.selectBarangay}
          </option>
          {barangays.map((barangay) => (
            <option key={barangay.code} value={barangay.code}>{barangay.name}</option>
          ))}
        </select>
      </div>
    </>
  );
}

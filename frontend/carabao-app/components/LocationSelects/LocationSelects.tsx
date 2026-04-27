'use client';

import { useEffect, useState } from 'react';
import { fetchRegions, fetchCitiesByRegion, type PsgcRegion, type PsgcCity } from '@/util/psgc';

interface LocationSelectsProps {
  value: string;
  onChange: (cityName: string) => void;
  selectClassName?: string;
  labelClassName?: string;
  wrapClassName?: string;
}

export default function LocationSelects({
  value,
  onChange,
  selectClassName = '',
  labelClassName = '',
  wrapClassName = '',
}: LocationSelectsProps) {
  const [regions, setRegions] = useState<PsgcRegion[]>([]);
  const [cities, setCities] = useState<PsgcCity[]>([]);
  const [regionCode, setRegionCode] = useState('');
  const [loadingRegions, setLoadingRegions] = useState(true);
  const [loadingCities, setLoadingCities] = useState(false);

  useEffect(() => {
    fetchRegions()
      .then(setRegions)
      .catch(() => {})
      .finally(() => setLoadingRegions(false));
  }, []);

  const handleRegionChange = async (code: string) => {
    setRegionCode(code);
    onChange('');
    setCities([]);
    if (!code) return;
    setLoadingCities(true);
    try {
      const data = await fetchCitiesByRegion(code);
      setCities(data);
    } catch {
      setCities([]);
    } finally {
      setLoadingCities(false);
    }
  };

  return (
    <>
      <div className={wrapClassName}>
        <label className={labelClassName}>Region</label>
        <select
          className={selectClassName}
          value={regionCode}
          onChange={(e) => void handleRegionChange(e.target.value)}
          disabled={loadingRegions}
        >
          <option value="">{loadingRegions ? 'Loading…' : 'Select region'}</option>
          {regions.map((r) => (
            <option key={r.code} value={r.code}>{r.name}</option>
          ))}
        </select>
      </div>

      <div className={wrapClassName}>
        <label className={labelClassName}>City / Municipality</label>
        <select
          className={selectClassName}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={!regionCode || loadingCities}
        >
          <option value="">
            {!regionCode ? 'Select a region first' : loadingCities ? 'Loading…' : 'Select city'}
          </option>
          {cities.map((c) => (
            <option key={c.code} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>
    </>
  );
}

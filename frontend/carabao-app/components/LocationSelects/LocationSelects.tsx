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

  const NCR_CODE = '1300000000';
  const [regions, setRegions] = useState<PsgcRegion[]>([]);
  const [provinces, setProvinces] = useState<PsgcProvince[]>([]);
  const [cities, setCities] = useState<PsgcCity[]>([]);
  const [barangays, setBarangays] = useState<PsgcBarangay[]>([]);
  const [loadingBarangays, setLoadingBarangays] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingProvinces, setLoadingProvinces] = useState(false);
  const [loadingRegions, setLoadingRegions] = useState(true);

  const selectedRegion = regions.find((region) => region.name === value.region);
  const selectedProvince = provinces.find((province) => province.name === value.province);
  const selectedCity = cities.find((city) => city.name === value.city);
  const selectedBarangay = barangays.find((barangay) => barangay.name === value.barangay);


  const handleRegionChange = async (regionCode: string) => {
    const region = regions.find((item) => item.code === regionCode);
    onChange({ 
      region: region?.name ?? "", 
      province: "", 
      city: "", 
      barangay: "" }
    );
  }

  const handleProvinceChange = async (provinceCode: string) => {
    const province = provinces.find((item) => item.code === provinceCode);
    onChange({ 
      region: value.region,
      province: province?.name ?? "", 
      city: "", 
      barangay: "" }
    );
  }

  const handleCityChange = async (cityCode: string) => {
    const city = cities.find((item) => item.code === cityCode);
    onChange({ 
      region: value.region,
      province: value.province,
      city: city?.name ?? "", 
      barangay: "" }
    );
  }
  
  const handleBarangayChange = async (barangayCode: string) => {
    const barangay = barangays.find((item) => item.code === barangayCode);
    onChange({ 
      region: value.region,
      province: value.province,
      city: value.city,
      barangay: barangay?.name ?? "" }
    );
  }

  const loadRegions = async () => {
    setLoadingRegions(true);
    const regions = await fetchRegions();
    setRegions(regions);
    setLoadingRegions(false);
  };

  const loadProvinces = async () => {
    const regionCode = regions.find((region) => region.name === value.region)?.code;
    if (regionCode === NCR_CODE) {
      setProvinces([]);
      setLoadingProvinces(false);
    } else if (regionCode) {
      setLoadingProvinces(true);
      const provinces = await fetchProvincesByRegion(regionCode);
      setProvinces(provinces);
      setLoadingProvinces(false);
    } else {
      setProvinces([]);
    }
  };

  const loadCities = async () => {
    const regionCode = regions.find((region) => region.name === value.region)?.code;
    const provinceCode = provinces.find((province) => province.name === value.province)?.code;
    if (regionCode === NCR_CODE) {
      setLoadingCities(true);
      const cities = await fetchCitiesByRegion(regionCode);
      setCities(cities);
      setLoadingCities(false);
    } else if (regionCode && provinceCode) {
      setLoadingCities(true);
      const cities = await fetchCitiesByProvince(regionCode, provinceCode);
      setCities(cities);
      setLoadingCities(false);
    } else {
      setCities([]);  
    }
  };

  const loadBarangays = async () => {
    const cityCode = cities.find((city) => city.name === value.city)?.code;
    if (cityCode) {
      setLoadingBarangays(true);
      const barangays = await fetchBarangaysByCity(cityCode);
      setBarangays(barangays);
      setLoadingBarangays(false);
    } else {
      setBarangays([]);
    }
  };

  useEffect(() => {
    void loadRegions();
  }, []);

  useEffect(() => {
    if (value.region && regions.length > 0) {
      void loadProvinces();
    } else {
      setProvinces([]);
    }
  }, [value.region, regions]);

  useEffect(() => {
    if (value.region && regions.length > 0) {
      void loadCities();
    } else {
      setCities([]);
    }
  }, [value.region, value.province, regions, provinces]);

  useEffect(() => {
    if (value.city) {
      void loadBarangays();
    } else {
      setBarangays([]);
    }
  }, [value.city]);


  return (
    <>
      <div className={wrapClassName} style={wrapStyle}>
        <label className={labelClassName} style={labelStyle}>Region</label>

        <select
          className={selectClassName}
          style={selectStyle}
          value={selectedRegion?.code ?? ''}
          onChange={(e) => void handleRegionChange(e.target.value)}
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
          onChange={(e) => void handleProvinceChange(e.target.value)}
          disabled={!value.region || selectedRegion?.code === NCR_CODE ||loadingProvinces}
        >
          <option value="">
            {!value.region ? 'Select a region first' : loadingProvinces ? 'Loading…' : 'Select province'}
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
          onChange={(e) => void handleCityChange(e.target.value)}
          disabled={!value.province || loadingCities}
        >
          <option value="">
            {!value.province ? 'Select a province first' : loadingCities ? 'Loading…' : 'Select city'}
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
          onChange={(e) => void handleBarangayChange(e.target.value)}
          disabled={!value.city || loadingBarangays}
        >
          <option value="">
            {!value.city? 'Select a city first' : loadingBarangays ? 'Loading…' : 'Select barangay'}
          </option>
          {barangays.map((barangay) => (
            <option key={barangay.code} value={barangay.code}>{barangay.name}</option>
          ))}
        </select>
      </div>

    </>
  );
}

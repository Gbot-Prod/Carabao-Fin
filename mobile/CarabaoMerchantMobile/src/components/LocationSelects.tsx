// src/components/LocationSelects.tsx
// S13 (plan §5.8): region -> province -> city -> barangay, read from the PSGC through
// src/lib/psgc.ts. The web's LocationSelects (frontend/carabao-app/components/LocationSelects)
// is the same four selects in the same order, with the same cascading resets; a phone has no
// <select>, so each field opens a sheet of options instead.
// Only Luzon regions are offered (B2, src/lib/serviceArea.ts) and NCR's province is always
// "Metro Manila", because the PSGC has no provinces for it (plan §2.2).
// The form keeps its own values: onChange hands back the four names to merge (a new region
// clears the province, city and barangay under it).
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchBarangaysByCity, fetchCitiesByProvince, fetchCitiesByRegion, fetchProvincesByRegion, fetchRegions,
  isNcrRegionName, NCR_CODE, provinceForRegion,
  type PsgcBarangay, type PsgcCity, type PsgcProvince, type PsgcRegion,
} from '../lib/psgc';
import { isLuzonRegion, NCR_PROVINCE } from '../lib/serviceArea';
import { LOCATION_WORDS, type LocationValue } from '../lib/pinLocation';
import { Colors, FontSize, Radius, Spacing } from '../lib/theme';

export type LocationSelectsValue = LocationValue;

type Props = {
  value: LocationSelectsValue;
  /** The four names after the pick; the caller merges them into its own address. */
  onChange: (value: LocationSelectsValue) => void;
  /** Per-select messages, shown under each select (rule 8). */
  errors?: Partial<Record<keyof LocationValue, string>>;
  /** A save in flight: every select waits. */
  disabled?: boolean;
};

/** One row of a select's sheet. Region, province, city and barangay all have a code and a name. */
type Choice = { code: string; name: string };

/**
 * Loads PSGC options for `key`, dropping answers for keys that are no longer current (the
 * person changed the region while the city list was loading). A null key means the parent
 * selection is missing, so there is nothing to load. Same as the web hook.
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
    // `load` is derived from `key`, so the key alone identifies the request (web does the same).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const isCurrent = key !== null && loaded.key === key;
  return { options: isCurrent ? loaded.options : [], loading: key !== null && !isCurrent };
}


type SelectFieldProps = {
  label: string;
  /** What the field says when nothing is picked: "Select region", "Select a city first"... */
  placeholder: string;
  /** The picked name, or '' when nothing is picked. */
  value: string;
  options: readonly Choice[];
  onPick: (code: string) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string;
  note?: string;
};

/** A label, a pressable field and a sheet holding the options; the search filters long lists. */
function SelectField({
  label, placeholder, value, options, onPick, disabled, loading, error, note,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => option.name.toLowerCase().includes(term));
  }, [options, search]);

  const close = () => {
    setOpen(false);
    setSearch('');
  };
  const pick = (code: string) => {
    close();
    onPick(code);
  };

  const unavailable = !!disabled || !!loading;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={[styles.input, unavailable && styles.inputDisabled, error ? styles.inputInvalid : null]}
        onPress={() => setOpen(true)}
        disabled={unavailable}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || placeholder}`}
        accessibilityHint={`Opens the list of ${label.toLowerCase()} options`}
        accessibilityState={{ disabled: unavailable }}
      >
        <Text style={[styles.inputText, !value && styles.placeholder]} numberOfLines={1}>
          {loading && !value ? LOCATION_WORDS.loading : value || placeholder}
        </Text>
        {loading ? (
          <ActivityIndicator size="small" color={Colors.textMuted} />
        ) : (
          <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
        )}
      </TouchableOpacity>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{label}</Text>
              <TouchableOpacity
                style={styles.sheetClose}
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel={`Close ${label.toLowerCase()} list`}
              >
                <Ionicons name="close" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.search}
              value={search}
              onChangeText={setSearch}
              placeholder={`Search ${label.toLowerCase()}`}
              placeholderTextColor={Colors.textLight}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={`Search ${label.toLowerCase()}`}
            />
            {shown.length === 0 ? (
              <Text style={styles.empty}>
                {options.length === 0 ? 'There is nothing to pick here.' : 'No match.'}
              </Text>
            ) : (
              <FlatList
                data={shown}
                keyExtractor={(item) => item.code}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={20}
                renderItem={({ item }) => {
                  const selected = item.name === value;
                  return (
                    <TouchableOpacity
                      style={[styles.option, selected && styles.optionSelected]}
                      onPress={() => pick(item.code)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{item.name}</Text>
                      {selected ? <Ionicons name="checkmark" size={18} color={Colors.primaryDark} /> : null}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * The four PSGC selects. The province follows the region, the city the province (NCR's cities
 * hang off the region), and the barangay the city; each pick clears the fields under it.
 */
export default function LocationSelects({ value, onChange, errors = {}, disabled }: Props) {
  const { options: allRegions, loading: loadingRegions } = usePsgcOptions<PsgcRegion>('regions', fetchRegions);
  // Only Luzon regions can be picked (B2); a saved region outside Luzon shows as unselected.
  const regions = useMemo(() => allRegions.filter((region) => isLuzonRegion(region.name)), [allRegions]);
  const selectedRegion = regions.find((region) => region.name === value.region);
  const regionCode = selectedRegion?.code;
  // A saved NCR address may open before the region list: its name is enough to skip the province.
  const isNcr = regionCode === NCR_CODE || isNcrRegionName(value.region);

  const { options: provinces, loading: loadingProvinces } = usePsgcOptions<PsgcProvince>(
    regionCode && !isNcr ? `provinces:${regionCode}` : null,
    () => fetchProvincesByRegion(regionCode!),
  );
  const provinceCode = provinces.find((province) => province.name === value.province)?.code;

  // NCR has no provinces, so its cities hang directly off the region.
  const { options: cities, loading: loadingCities } = usePsgcOptions<PsgcCity>(
    isNcr && regionCode
      ? `cities:${regionCode}`
      : regionCode && provinceCode ? `cities:${regionCode}:${provinceCode}` : null,
    () => (isNcr ? fetchCitiesByRegion(regionCode!) : fetchCitiesByProvince(regionCode!, provinceCode!)),
  );
  const cityCode = cities.find((city) => city.name === value.city)?.code;

  const { options: barangays, loading: loadingBarangays } = usePsgcOptions<PsgcBarangay>(
    cityCode ? `barangays:${cityCode}` : null,
    () => fetchBarangaysByCity(cityCode!),
  );

  const pickRegion = (code: string) => {
    const region = regions.find((item) => item.code === code);
    // NCR has no provinces: it is always Metro Manila (site standard, src/lib/psgc.ts).
    onChange({
      region: region?.name ?? '',
      province: provinceForRegion(code, region?.name),
      city: '',
      barangay: '',
    });
  };

  const pickProvince = (code: string) => {
    const province = provinces.find((item) => item.code === code);
    onChange({ region: value.region ?? '', province: province?.name ?? '', city: '', barangay: '' });
  };

  const pickCity = (code: string) => {
    const city = cities.find((item) => item.code === code);
    onChange({
      region: value.region ?? '',
      province: value.province ?? '',
      city: city?.name ?? '',
      barangay: '',
    });
  };

  const pickBarangay = (code: string) => {
    const barangay = barangays.find((item) => item.code === code);
    onChange({
      region: value.region ?? '',
      province: value.province ?? '',
      city: value.city ?? '',
      barangay: barangay?.name ?? '',
    });
  };

  const provincePlaceholder = !value.region
    ? LOCATION_WORDS.selectRegionFirst
    : isNcr ? NCR_PROVINCE : loadingProvinces ? LOCATION_WORDS.loading : LOCATION_WORDS.selectProvince;
  const cityPlaceholder = !value.region
    ? LOCATION_WORDS.selectRegionFirst
    : !isNcr && !value.province
      ? LOCATION_WORDS.selectProvinceFirst
      : loadingCities ? LOCATION_WORDS.loading : LOCATION_WORDS.selectCity;
  const barangayPlaceholder = !value.city
    ? LOCATION_WORDS.selectCityFirst
    : loadingBarangays ? LOCATION_WORDS.loading : LOCATION_WORDS.selectBarangay;

  return (
    <View>
      <SelectField
        label={LOCATION_WORDS.region}
        placeholder={loadingRegions ? LOCATION_WORDS.loading : LOCATION_WORDS.selectRegion}
        value={selectedRegion?.name ?? value.region ?? ''}
        options={regions}
        onPick={pickRegion}
        disabled={disabled}
        loading={loadingRegions}
        error={errors.region}
        note={LOCATION_WORDS.serviceAreaNote}
      />
      <SelectField
        label={LOCATION_WORDS.province}
        placeholder={provincePlaceholder}
        // NCR's province is fixed: the field says Metro Manila and cannot be opened.
        value={value.province || (isNcr ? NCR_PROVINCE : '')}
        options={provinces}
        onPick={pickProvince}
        disabled={disabled || !value.region || isNcr}
        loading={loadingProvinces}
        error={errors.province}
      />
      <SelectField
        label={LOCATION_WORDS.city}
        placeholder={cityPlaceholder}
        value={value.city ?? ''}
        options={cities}
        onPick={pickCity}
        disabled={disabled || !value.region || (!isNcr && !value.province)}
        loading={loadingCities}
        error={errors.city}
      />
      <SelectField
        label={LOCATION_WORDS.barangay}
        placeholder={barangayPlaceholder}
        value={value.barangay ?? ''}
        options={barangays}
        onPick={pickBarangay}
        disabled={disabled || !value.city}
        loading={loadingBarangays}
        error={errors.barangay}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: Spacing.md },
  label: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginBottom: 6 },
  input: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, minHeight: 46,
    backgroundColor: Colors.surfaceAlt,
  },
  inputDisabled: { backgroundColor: Colors.borderLight },
  inputInvalid: { borderColor: Colors.error },
  inputText: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  placeholder: { color: Colors.textLight },
  error: { color: Colors.error, fontSize: FontSize.xs, marginTop: 4 },
  note: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  // The options sheet: a bottom sheet like the app's other pickers.
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.white, padding: Spacing.lg, maxHeight: '80%',
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  sheetClose: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  search: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 10, marginTop: Spacing.md,
    fontSize: FontSize.sm, color: Colors.text, backgroundColor: Colors.surfaceAlt,
  },
  empty: { fontSize: FontSize.sm, color: Colors.textMuted, paddingVertical: Spacing.lg },
  option: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 48, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  optionSelected: { backgroundColor: Colors.primaryLight },
  optionText: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  optionTextSelected: { fontWeight: '700', color: Colors.primaryDark },
});

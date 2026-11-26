// src/components/AddressForm.tsx
// S13 (plan §5.8): the delivery address building block - region, province, city and barangay
// (PSGC selects), postal code and street, then the pin on the map. It is standalone: it owns no
// save of its own. Store settings (S16) renders it; the onboarding screen (S18) will too. The
// screen holds an AddressValue, renders this form, and on save runs
// checkAddress / addressPayload (src/lib/pinLocation.ts) before calling the API.
// Rule 8: every message shows under its own field, so a screen can pass checkAddress's words or
// the server's fieldErrors and they land in the same places.
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ADDRESS_LABELS, ADDRESS_MAX, type AddressErrors, type AddressValue } from '../lib/pinLocation';
import { Colors, FontSize, Radius, Spacing } from '../lib/theme';
import AddressPinMap from './AddressPinMap';
import LocationSelects from './LocationSelects';
import StreetSuggestInput from './StreetSuggestInput';

export type AddressFormProps = {
  value: AddressValue;
  /** The whole address after an edit; the screen keeps it (nothing is saved here). */
  onChange: (value: AddressValue) => void;
  /** Per-field messages: checkAddress's own words, or the server's fieldErrors (CF-0123). */
  errors?: AddressErrors;
  /** The signed-in token: the pin needs it for geocoding and the road check. */
  token: string | null;
  /** A save in flight: every field waits. */
  disabled?: boolean;
};

export default function AddressForm({ value, onChange, errors = {}, token, disabled }: AddressFormProps) {
  // A place pick carries only the four names; the rest of the address stays as it is.
  const setPlace = (place: Partial<AddressValue>) => onChange({ ...value, ...place });
  const pin = value.latitude != null && value.longitude != null
    ? { lat: value.latitude, lng: value.longitude }
    : null;

  return (
    <View>
      <LocationSelects
        value={{ region: value.region, province: value.province, city: value.city, barangay: value.barangay }}
        onChange={setPlace}
        errors={{
          region: errors.region,
          province: errors.province,
          city: errors.city,
          barangay: errors.barangay,
        }}
        disabled={disabled}
      />

      <View style={styles.field}>
        <Text style={styles.label}>{ADDRESS_LABELS.postalCode}</Text>
        <TextInput
          style={[styles.input, errors.postal_code ? styles.inputInvalid : null]}
          value={value.postal_code}
          onChangeText={(postal_code) => onChange({ ...value, postal_code })}
          placeholder={ADDRESS_LABELS.postalPlaceholder}
          placeholderTextColor={Colors.textLight}
          keyboardType="number-pad"
          maxLength={ADDRESS_MAX.postal_code}
          editable={!disabled}
          accessibilityLabel={ADDRESS_LABELS.postalCode}
        />
        {errors.postal_code ? <Text style={styles.error}>{errors.postal_code}</Text> : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{ADDRESS_LABELS.street}</Text>
        <StreetSuggestInput
          token={token}
          area={{ province: value.province, city: value.city }}
          onPick={(street, next) => onChange({
            ...value,
            street,
            latitude: next.lat,
            longitude: next.lng,
            pin_confirmed: false,
          })}
          style={[styles.input, errors.address ? styles.inputInvalid : null]}
          value={value.street}
          onChangeText={(street) => onChange({ ...value, street })}
          placeholder={ADDRESS_LABELS.streetPlaceholder}
          placeholderTextColor={Colors.textLight}
          maxLength={ADDRESS_MAX.street}
          editable={!disabled}
          accessibilityLabel={ADDRESS_LABELS.street}
        />
        {errors.address ? <Text style={styles.error}>{errors.address}</Text> : null}
      </View>

      {/* The map stays locked until this whole address is filled in, and the address places
          the first pin (src/components/AddressPinMap.tsx). */}
      <AddressPinMap
        address={{
          province: value.province,
          city: value.city,
          barangay: value.barangay,
          postalCode: value.postal_code,
          street: value.street,
        }}
        pin={pin}
        confirmed={value.pin_confirmed}
        onChange={(next, confirmed) => onChange({
          ...value,
          latitude: next.lat,
          longitude: next.lng,
          pin_confirmed: confirmed,
        })}
        token={token}
        error={errors.pin}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginTop: Spacing.md },
  label: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 11,
    fontSize: FontSize.sm, color: Colors.text, backgroundColor: Colors.surfaceAlt,
  },
  inputInvalid: { borderColor: Colors.error },
  error: { color: Colors.error, fontSize: FontSize.xs, marginTop: 4 },
});

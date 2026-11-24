// src/components/AddressPinMap.web.tsx
// S13: react-native-maps has no web implementation, so the browser preview (`npm run web`) shows
// a note where the pin map would be. Android and iOS bundle AddressPinMap.tsx instead. Both files
// export the same default and share the prop types, so AddressForm does not branch on platform.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PIN_WORDS } from '../lib/pinLocation';
import { Colors, FontSize, Spacing } from '../lib/theme';
import { MapUnavailable } from './MapUnavailable';
import type { AddressPinMapProps } from './AddressPinMap';

export type { AddressPinMapProps } from './AddressPinMap';

const WEB_PIN_NOTE =
  'The pin map is not available in the browser preview. Place the pin in the Android or iOS app.';

export default function AddressPinMap(_props: AddressPinMapProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{PIN_WORDS.label}</Text>
      <MapUnavailable note={WEB_PIN_NOTE} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.md },
  label: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginBottom: 6 },
});

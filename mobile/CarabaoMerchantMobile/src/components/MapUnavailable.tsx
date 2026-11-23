// src/components/MapUnavailable.tsx
// S12: what stands in for the map when it cannot be drawn — Android without a Google Maps key
// (decision D3) or the web preview, which has no react-native-maps. The stop list below it keeps
// every stop, its number and its links, so the screen stays usable.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, FontSize, Radius, Spacing } from '../lib/theme';

export function MapUnavailable({ note }: { note: string }) {
  return (
    <View style={styles.box} accessibilityRole="alert">
      <Ionicons name="map-outline" size={22} color={Colors.textMuted} />
      <Text style={styles.text}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  text: { flex: 1, fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17 },
});

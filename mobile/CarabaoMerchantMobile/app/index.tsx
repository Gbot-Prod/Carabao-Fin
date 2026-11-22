// app/index.tsx
// Placeholder while the app is scaffolded (plan §4.1). Replaced by the dashboard tab in the
// section that moves the merchant screens out of the buyer app. Styles are inline on purpose:
// this section only creates the bootable tree, `src/lib/theme.ts` arrives with the shared
// copies (S2).
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';

export default function PlaceholderScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <Text style={styles.title}>Carabao Merchant</Text>
        <Text style={styles.sub}>Setting up your farm app…</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f9fafb' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  title: { fontSize: 17, fontWeight: '800', color: '#111827' },
  sub: { fontSize: 13, color: '#6b7280' },
});

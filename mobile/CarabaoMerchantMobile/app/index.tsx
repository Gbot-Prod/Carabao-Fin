// app/index.tsx
// Placeholder while the app is scaffolded (plan §4.1). Replaced by the dashboard tab in the
// section that moves the merchant screens out of the buyer app.
import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { Colors, Spacing, FontSize } from '../src/lib/theme';

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
  root: { flex: 1, backgroundColor: Colors.offWhite },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  title: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textMuted },
});

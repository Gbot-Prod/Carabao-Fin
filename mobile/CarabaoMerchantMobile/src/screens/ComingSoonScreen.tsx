// src/screens/ComingSoonScreen.tsx
// S3 (plan §4, decision D2): the screens later sections add (Shipments S11, Route S12,
// Earnings S9, Shop page S14, Vouchers S15, Store settings S16, Application S18). Each
// route renders this one screen until its section replaces the file, so every row in More
// opens something and no row is a dead end.
import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { Colors, FontSize, Radius, Spacing } from '../lib/theme';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

// Decision D2's routes. The owning section deletes its app/<route>.tsx and puts its own
// screen there; the entry here goes with it.
const SCREENS: Record<string, { title: string; icon: IoniconName }> = {
  '/shipments': { title: 'Shipments', icon: 'cube-outline' },
  '/route': { title: 'Route', icon: 'map-outline' },
  '/earnings': { title: 'Earnings', icon: 'cash-outline' },
  '/shop': { title: 'Shop page', icon: 'storefront-outline' },
  '/vouchers': { title: 'Vouchers', icon: 'pricetag-outline' },
  '/settings': { title: 'Store settings', icon: 'settings-outline' },
  '/application': { title: 'Application', icon: 'document-text-outline' },
};

const FALLBACK = { title: 'Coming soon', icon: 'construct-outline' as IoniconName };

export default function ComingSoonScreen() {
  const router = useRouter();
  const { title, icon } = SCREENS[usePathname()] ?? FALLBACK;
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={34} color={Colors.primary} />
        </View>
        <Text style={styles.title}>{title} is coming soon</Text>
        <Text style={styles.text}>
          This screen is being built in a later update. Nothing is missing from your farm’s data
          in the meantime.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  iconWrap: {
    width: 72, height: 72, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt, marginBottom: Spacing.sm,
  },
  title: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  text: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', lineHeight: 20 },
});

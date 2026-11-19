// src/screens/MerchantDashboardScreen.tsx
// CF-0125: the merchant home (web merchant shell): numbers, stock alerts, what
// buyers in the province look for, and links to orders / listings / reviews.
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiStockAlerts } from '../lib/api';
import { alertCounts, cancelRate, statTiles, unmetSearches, type DemandInsight, type MerchantPerformance } from '../lib/dashboard';
import { ratingLabel } from '../lib/farms';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { SkeletonList, LoadError } from '../components/Skeleton';

type Data = { perf: MerchantPerformance; alerts: ApiStockAlerts | null; demand: DemandInsight | null };

function Content() {
  const router = useRouter();
  const { token } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.merchants.performance(token),
      // Extras: the dashboard still shows without them.
      api.merchants.stockAlerts(token).catch(() => null),
      api.merchants.demand(token).catch(() => null),
    ])
      .then(([perf, alerts, demand]) => { if (active) { setData({ perf, alerts, demand }); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [token, attempt]);

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>{data?.perf.merchant_name ?? 'Dashboard'}</Text>
    </View>
  );

  if (failed && !data) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <LoadError message="We couldn’t load your dashboard." onRetry={() => setAttempt((n) => n + 1)} />
      </SafeAreaView>
    );
  }
  if (!data) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <SkeletonList label="Loading dashboard" rows={3} grid />
      </SafeAreaView>
    );
  }

  const { perf, alerts, demand } = data;
  const counts = alertCounts(alerts);
  const rate = cancelRate(perf);
  const unmet = unmetSearches(demand);
  const link = (icon: React.ComponentProps<typeof Ionicons>['name'], label: string, href: Href, badge?: number) => (
    <TouchableOpacity key={label} style={styles.link} onPress={() => router.push(href)} accessibilityRole="button" accessibilityLabel={badge ? `${label}, ${badge}` : label}>
      <Ionicons name={icon} size={20} color={Colors.primary} />
      <Text style={styles.linkText}>{label}</Text>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setAttempt((n) => n + 1); }} />}
      >
        <View style={styles.tiles}>
          {statTiles(perf).map((t) => (
            <View key={t.key} style={styles.tile} accessible accessibilityLabel={`${t.label}: ${t.value}`}>
              <Text style={styles.tileValue}>{t.value}</Text>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.muted}>
          Rating {ratingLabel(perf.rating)} ({perf.rating_count}) · {perf.total_orders} orders in total
          {rate !== null ? ` · ${rate}% cancelled` : ''}
        </Text>

        <View style={styles.card}>
          {link('receipt-outline', 'Incoming orders', '/merchant-orders', perf.active_orders)}
          {link('leaf-outline', 'My listings', '/listings', counts.total)}
          {link('chatbubbles-outline', 'Chats', '/merchant-chats')}
          {link('star-outline', 'Reviews', '/merchant-reviews')}
        </View>

        {counts.total > 0 && (
          <View style={styles.card} accessibilityRole="alert">
            <Text style={styles.cardTitle}>Stock alerts</Text>
            {counts.low > 0 && <Text style={styles.alert}>{counts.low} listing{counts.low === 1 ? '' : 's'} low on stock (≤ {alerts?.low_stock_threshold})</Text>}
            {counts.expiring > 0 && <Text style={styles.alert}>{counts.expiring} best-before within {alerts?.expiry_warning_days} days</Text>}
            {counts.expired > 0 && <Text style={styles.alert}>{counts.expired} past best-before: buyers can’t see {counts.expired === 1 ? 'it' : 'them'}</Text>}
          </View>
        )}

        {demand && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Buyers in {demand.province}, last {demand.days} days</Text>
            {demand.most_ordered.length > 0 && (
              <>
                <Text style={styles.sub}>Most ordered</Text>
                {demand.most_ordered.slice(0, 5).map((m) => (
                  <Text key={m.name} style={styles.row}>{m.name} · {m.orders} orders</Text>
                ))}
              </>
            )}
            {unmet.length > 0 && (
              <>
                <Text style={styles.sub}>Searched, but no one lists it</Text>
                {unmet.map((t) => (
                  <Text key={t.query} style={styles.row}>“{t.query}” · {t.no_result_searches} searches found nothing</Text>
                ))}
              </>
            )}
            {demand.most_ordered.length === 0 && unmet.length === 0 && <Text style={styles.muted}>Not enough activity yet.</Text>}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function MerchantDashboardScreen() {
  return (
    <ProtectedScreen requiredRole="merchant">
      <Content />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 60 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: {
    width: '48%', flexGrow: 1, backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  tileValue: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary },
  tileLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  muted: { fontSize: FontSize.xs, color: Colors.textMuted },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, gap: 6,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  cardTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  sub: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginTop: Spacing.xs },
  row: { fontSize: FontSize.sm, color: Colors.text },
  alert: { fontSize: FontSize.sm, color: Colors.error },
  link: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 48 },
  linkText: { flex: 1, fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  badge: {
    minWidth: 24, textAlign: 'center', fontSize: FontSize.xs, fontWeight: '800', color: Colors.white,
    backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 6, overflow: 'hidden',
  },
});

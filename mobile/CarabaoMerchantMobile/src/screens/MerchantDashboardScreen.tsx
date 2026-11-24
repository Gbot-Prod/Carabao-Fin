// src/screens/MerchantDashboardScreen.tsx
// CF-0125 / S19 (plan §5.1): the merchant home, as the web M/(shell)/page.tsx: the greeting,
// the "not live yet" banner (VerificationBanner), the setup checklist (SetupChecklist), stat
// cards, "Needs your attention", revenue and orders bars for the last 30 days (plain View bars,
// decision §2.2) and the recent orders. Performance, produce, the shop page and the orders come
// from the shared data context (S3); this screen loads only what no other screen shares.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { useMerchantGate } from '../lib/MerchantContext';
import { useMerchantData } from '../lib/MerchantDataContext';
import {
  api, type ApiMyMerchant, type ApiStockAlerts, type AvailablePayout, type MerchantPayoutBatch, type MerchantSales,
} from '../lib/api';
import {
  attentionRows, barHeights, compactPeso, DASHBOARD_WORDS as W, greeting, openTotal, recentOrders, salesWindows,
  statCards, verificationBanner, type AttentionTone,
} from '../lib/dashboard';
import { itemRoute, setupChecklist, CHECKLIST_WORDS } from '../lib/setupChecklist';
import { APPLICATION_WORDS } from '../lib/application';
import { formatPeso, orderDate, shortDate } from '../lib/format';
import { orderStatusColor, orderStatusLabel } from '../lib/orderStatus';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { SkeletonList, LoadError } from '../components/Skeleton';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/** What only this screen loads; each part shows what loaded (web Promise.allSettled). */
type Extras = {
  sales: MerchantSales | null;
  alerts: ApiStockAlerts | null;
  available: AvailablePayout | null;
  payouts: MerchantPayoutBatch[];
  merchant: ApiMyMerchant | null;
  /** undefined while loading; false when no payout account is set up (web SetupChecklist). */
  hasPayout: boolean | undefined;
  adminNote: string | null;
};

const EMPTY: Extras = { sales: null, alerts: null, available: null, payouts: [], merchant: null, hasPayout: undefined, adminNote: null };

const TONES: Record<AttentionTone, { fg: string; bg: string }> = {
  green: { fg: Colors.primaryDark, bg: Colors.primaryLight },
  blue: { fg: '#1d4ed8', bg: '#dbeafe' },
  amber: { fg: '#b45309', bg: Colors.warningBg },
  violet: { fg: '#6d28d9', bg: '#ede9fe' },
  red: { fg: Colors.error, bg: Colors.errorBg },
};

const ATTENTION_ICONS: Record<string, IoniconName> = {
  ship: 'car-outline',
  delivery: 'calendar-outline',
  low: 'cube-outline',
  out: 'close-circle-outline',
  expiry: 'warning-outline',
  payout: 'cash-outline',
  paused: 'pause-circle-outline',
  setup: 'storefront-outline',
};

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  green: TONES.green,
  blue: TONES.blue,
  yellow: TONES.amber,
  gray: { fg: Colors.textMuted, bg: Colors.borderLight },
};

/** 30 plain View bars, oldest left; the first and last dates under them. */
function Bars({ days, pick, color, label }: {
  days: MerchantSales['daily'];
  pick: (d: MerchantSales['daily'][number]) => number;
  color: string;
  label: string;
}) {
  const values = days.map(pick);
  const heights = barHeights(values);
  return (
    <View accessible accessibilityLabel={label}>
      <View style={styles.bars}>
        {heights.map((h, i) => (
          <View key={days[i].date} style={styles.barSlot}>
            <View style={[styles.bar, { height: `${h}%`, backgroundColor: color }]} />
          </View>
        ))}
      </View>
      <View style={styles.barAxis}>
        <Text style={styles.axisText}>{shortDate(days[0]?.date)}</Text>
        <Text style={styles.axisText}>{shortDate(days[days.length - 1]?.date)}</Text>
      </View>
    </View>
  );
}

// The Home tab. The root gate (app/_layout.tsx) already checked the farm, so this
// screen does not repeat that check.
export default function MerchantDashboardScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { profile } = useMerchantGate();
  const {
    performance, produce, shopPage, orders, loading, error,
    refreshPerformance, refreshProduce, refreshShopPage, refreshOrders,
  } = useMerchantData();
  const [extras, setExtras] = useState<Extras | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const status = performance?.verification_status;
  // The access token is refreshed about every minute; a ref keeps the newest one without
  // loading the cards again (same idea as MerchantDataContext.tsx).
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  useEffect(() => {
    let active = true;
    const t = tokenRef.current;
    // Each card shows what loaded; one failed call does not hide the page (as the web).
    Promise.allSettled([
      api.merchants.sales(t, 90),
      api.merchants.stockAlerts(t),
      api.payout.availablePayout(t),
      api.payout.payouts(t),
      api.merchants.myMerchant(t),
      api.payout.info(t),
    ]).then(([s, a, av, p, m, info]) => {
      if (!active) return;
      setExtras((prev) => ({
        sales: s.status === 'fulfilled' ? s.value : null,
        alerts: a.status === 'fulfilled' ? a.value : null,
        available: av.status === 'fulfilled' ? av.value : null,
        payouts: p.status === 'fulfilled' ? p.value : [],
        merchant: m.status === 'fulfilled' ? m.value : null,
        hasPayout: info.status === 'fulfilled' ? info.value != null : false,
        adminNote: prev?.adminNote ?? null,
      }));
    });
    return () => { active = false; };
  }, [attempt]);

  // The admin's notes, only while Carabao has not verified the farm (web MerchantContext).
  useEffect(() => {
    if (!status || status === 'verified') return;
    let active = true;
    api.onboarding.myApplication(tokenRef.current)
      .then((app) => { if (active) setExtras((prev) => ({ ...(prev ?? EMPTY), adminNote: app?.admin_note ?? null })); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [status, attempt]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setAttempt((n) => n + 1);
    await Promise.all([refreshPerformance(), refreshProduce(), refreshShopPage(), refreshOrders()]);
    setRefreshing(false);
  }, [refreshPerformance, refreshProduce, refreshShopPage, refreshOrders]);

  const go = (path: string) => router.push(path as Href);

  const recent = useMemo(() => recentOrders(orders ?? []), [orders]);

  const header = (
    <View style={styles.header}>
      {/* A tab root has no screen behind it, so it has no Back button. */}
      <Text style={styles.eyebrow}>{W.eyebrow}</Text>
      <Text style={styles.headerTitle} numberOfLines={1}>{performance?.merchant_name || W.fallbackTitle}</Text>
    </View>
  );

  if (!performance && !loading && error) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <LoadError message="We couldn’t load your dashboard." onRetry={() => void onRefresh()} />
      </SafeAreaView>
    );
  }
  if (!performance || !extras) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <SkeletonList label="Loading dashboard" rows={4} grid />
      </SafeAreaView>
    );
  }

  const banner = verificationBanner(status);
  const checklist = setupChecklist({
    status,
    shopPage,
    // The web counts produce once it is loaded, else uses performance (MerchantContext).
    productCount: produce ? produce.length : performance.total_products,
    hasPayout: extras.hasPayout,
    adminNote: extras.adminNote,
  });
  const cards = statCards({
    performance, sales: extras.sales, orders, produce,
    lowStock: extras.alerts?.low_stock.length ?? 0, available: extras.available,
  });
  const attention = attentionRows({
    orders: orders ?? [], produce: produce ?? [], alerts: extras.alerts, payouts: extras.payouts,
    shopPage, merchant: extras.merchant,
  });
  const open = openTotal(attention);
  const w = salesWindows(extras.sales?.daily ?? []);

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
      >
        <Text style={styles.greeting}>{greeting(profile?.name)}</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => go('/(tabs)/orders')} accessibilityRole="button">
            <Ionicons name="bag-outline" size={16} color={Colors.text} />
            <Text style={styles.btnSecondaryText}>{W.viewOrders}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnPrimary} onPress={() => go('/(tabs)/produce')} accessibilityRole="button">
            <Ionicons name="add" size={16} color={Colors.white} />
            <Text style={styles.btnPrimaryText}>{W.addProduce}</Text>
          </TouchableOpacity>
        </View>

        {banner && (
          <View style={styles.banner} accessibilityRole="alert">
            <Ionicons name="time-outline" size={18} color={Colors.text} />
            <View style={styles.bannerBody}>
              <Text style={styles.bannerText}>
                <Text style={styles.bannerTitle}>{banner.title}</Text>
                {banner.text ? ` ${banner.text}` : ''}
              </Text>
              {banner.action && (
                <TouchableOpacity onPress={() => go(banner.action!.path)} accessibilityRole="button" style={styles.bannerAction}>
                  <Text style={styles.bannerActionText}>{banner.action.label}</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {checklist && (
          <View style={styles.card}>
            <View style={styles.cardHeadRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{CHECKLIST_WORDS.title}</Text>
                <Text style={styles.muted}>{checklist.sub}</Text>
              </View>
              <Text style={styles.progress} accessibilityLabel={`${checklist.doneCount} of ${checklist.items.length} steps done`}>
                {checklist.doneCount}/{checklist.items.length}
              </Text>
            </View>
            {checklist.items.map((item) => {
              const route = itemRoute(item);
              const body = (
                <>
                  <Ionicons
                    name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
                    size={20}
                    color={item.done ? Colors.primary : Colors.textLight}
                  />
                  <View style={styles.stepText}>
                    <Text style={[styles.stepLabel, item.done && styles.stepDone]}>{item.label}</Text>
                    {item.detail ? <Text style={styles.muted}>{item.detail}</Text> : null}
                    {item.note ? <Text style={styles.note}>{APPLICATION_WORDS.notePrefix}{item.note}</Text> : null}
                  </View>
                  {route ? <Ionicons name="chevron-forward" size={16} color={Colors.textLight} /> : null}
                </>
              );
              const a11y = `${item.label}${item.done ? ' (done)' : ' (to do)'}`;
              return route ? (
                <TouchableOpacity key={item.key} style={styles.step} onPress={() => go(route)} accessibilityRole="button" accessibilityLabel={a11y}>
                  {body}
                </TouchableOpacity>
              ) : (
                <View key={item.key} style={styles.step} accessible accessibilityLabel={a11y}>{body}</View>
              );
            })}
          </View>
        )}

        <View style={styles.tiles}>
          {cards.map((t) => {
            const body = (
              <>
                <Text style={styles.tileLabel}>{t.label}</Text>
                <Text style={styles.tileValue}>{t.value}</Text>
                <Text style={styles.tileSub}>
                  {t.sub}
                  {t.delta ? <Text style={t.delta.startsWith('↑') ? styles.deltaUp : styles.deltaDown}>{`  ${t.delta}`}</Text> : null}
                </Text>
              </>
            );
            const label = `${t.label}: ${t.value}. ${t.sub}${t.delta ? `, ${t.delta}` : ''}`;
            return t.route ? (
              <TouchableOpacity
                key={t.key}
                style={[styles.tile, t.alert && styles.tileAlert]}
                onPress={() => go(t.route!)}
                accessibilityRole="button"
                accessibilityLabel={label}
              >
                {body}
              </TouchableOpacity>
            ) : (
              <View key={t.key} style={styles.tile} accessible accessibilityLabel={label}>{body}</View>
            );
          })}
        </View>

        <View style={[styles.card, styles.cardFlush]}>
          <View style={styles.attnHead}>
            <Text style={styles.cardTitle}>{W.attentionTitle}</Text>
            {open > 0 && <Text style={styles.alertBadge}>{open} open</Text>}
          </View>
          {attention.map((row) => {
            const tone = TONES[row.count > 0 ? row.tone : 'green'];
            const sub = row.count > 0 ? row.action : W.nothingWaiting;
            return (
              <TouchableOpacity
                key={row.key}
                style={styles.attnRow}
                onPress={() => go(row.route)}
                accessibilityRole="button"
                accessibilityLabel={`${row.label}, ${row.count}. ${sub}`}
              >
                <View style={[styles.attnIcon, { backgroundColor: tone.bg }]}>
                  <Ionicons name={ATTENTION_ICONS[row.key]} size={16} color={tone.fg} />
                </View>
                <View style={styles.stepText}>
                  <Text style={styles.stepLabel}>{row.label}</Text>
                  <Text style={styles.muted}>{sub}</Text>
                </View>
                <Text style={[styles.attnCount, row.count > 0 && styles.attnCountActive]}>{row.count.toLocaleString('en-PH')}</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
              </TouchableOpacity>
            );
          })}
          {open === 0 && <Text style={styles.allClear}>{W.allClear}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{W.revenueTitle}</Text>
          <Text style={styles.bigValue}>{formatPeso(w.rev30)}</Text>
          <Text style={styles.muted}>{w.hasPrevious && w.revPrev30 > 0 ? W.revenueSubCompared : W.revenueSub}</Text>
          {!extras.sales ? (
            <Text style={styles.empty}>{W.salesError}</Text>
          ) : w.rev30 === 0 ? (
            <Text style={styles.empty}>{W.noSales}</Text>
          ) : (
            <>
              <Text style={styles.axisText}>{compactPeso(Math.max(...w.last30.map((d) => d.revenue)))}</Text>
              <Bars days={w.last30} pick={(d) => d.revenue} color={Colors.primary} label={`Revenue per day, last 30 days: ${formatPeso(w.rev30)} in total`} />
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{W.ordersTitle}</Text>
          <Text style={styles.muted}>{W.ordersSub}</Text>
          {!extras.sales || w.orders30 === 0 ? (
            <Text style={styles.empty}>{W.noOrders}</Text>
          ) : (
            <>
              <Text style={styles.axisText}>{Math.max(...w.last30.map((d) => d.orders))}</Text>
              <Bars days={w.last30} pick={(d) => d.orders} color={Colors.primaryDark} label={`Orders per day, last 30 days: ${w.orders30} in total`} />
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{W.recentTitle}</Text>
          {recent.length === 0 ? (
            <Text style={styles.empty}>{orders ? W.noOrdersYet : error ?? W.loadingOrders}</Text>
          ) : (
            recent.map((o) => {
              const c = STATUS_COLORS[orderStatusColor(o.status)] ?? STATUS_COLORS.gray;
              return (
                <TouchableOpacity
                  key={o.id}
                  style={styles.orderRow}
                  onPress={() => router.push({ pathname: '/(tabs)/orders', params: { order: String(o.id) } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Order ${o.id}, ${o.buyer_name ?? 'buyer'}, ${orderStatusLabel(o.status)}, ${formatPeso(o.total_price)}`}
                >
                  <View style={styles.stepText}>
                    <Text style={styles.stepLabel}>#{o.id} · {o.buyer_name ?? '—'}</Text>
                    <Text style={styles.muted}>{orderDate(o.ordered_at)}</Text>
                  </View>
                  <Text style={[styles.pill, { color: c.fg, backgroundColor: c.bg }]}>{orderStatusLabel(o.status)}</Text>
                  <Text style={styles.orderTotal}>{formatPeso(o.total_price)}</Text>
                </TouchableOpacity>
              );
            })
          )}
          <TouchableOpacity style={styles.cardLink} onPress={() => go('/(tabs)/orders')} accessibilityRole="button">
            <Text style={styles.cardLinkText}>{W.allOrders}</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.primaryDark} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const card = {
  backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.md, gap: 6,
  borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, minHeight: 60, justifyContent: 'center',
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 60 },
  greeting: { fontSize: FontSize.sm, color: Colors.textMuted },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  btnPrimary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44,
    borderRadius: Radius.full, backgroundColor: Colors.primary,
  },
  btnPrimaryText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  btnSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44,
    borderRadius: Radius.full, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
  },
  btnSecondaryText: { color: Colors.text, fontWeight: '700', fontSize: FontSize.sm },
  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md,
    borderRadius: Radius.md, backgroundColor: Colors.warningBg, borderWidth: 1, borderColor: Colors.warning,
  },
  bannerBody: { flex: 1, gap: Spacing.sm },
  bannerText: { fontSize: FontSize.sm, color: Colors.text },
  bannerTitle: { fontWeight: '800' },
  bannerAction: {
    alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', paddingHorizontal: Spacing.md,
    borderRadius: Radius.full, backgroundColor: Colors.text,
  },
  bannerActionText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  card,
  cardFlush: { paddingHorizontal: 0, paddingBottom: 0 },
  cardHeadRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  cardTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  progress: {
    fontSize: FontSize.sm, fontWeight: '800', color: Colors.primaryDark, backgroundColor: Colors.primaryLight,
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2, overflow: 'hidden',
  },
  step: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 48, paddingVertical: 4 },
  stepText: { flex: 1, gap: 1 },
  stepLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  stepDone: { color: Colors.textMuted },
  note: { fontSize: FontSize.xs, color: Colors.text, fontStyle: 'italic' },
  muted: { fontSize: FontSize.xs, color: Colors.textMuted },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { ...card, width: '48%', flexGrow: 1, gap: 2 },
  tileAlert: { borderColor: Colors.warning, backgroundColor: Colors.warningBg },
  tileLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  tileValue: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primaryDark },
  tileSub: { fontSize: FontSize.xs, color: Colors.textMuted },
  deltaUp: { color: Colors.primaryDark, fontWeight: '700' },
  deltaDown: { color: Colors.error, fontWeight: '700' },
  attnHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingBottom: 4 },
  alertBadge: {
    fontSize: FontSize.xs, fontWeight: '800', color: Colors.error, backgroundColor: Colors.errorBg,
    borderRadius: Radius.full, paddingHorizontal: Spacing.sm, paddingVertical: 2, overflow: 'hidden',
  },
  attnRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 56, paddingHorizontal: Spacing.md,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  attnIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  attnCount: { fontSize: FontSize.md, fontWeight: '800', color: Colors.textLight, minWidth: 24, textAlign: 'right' },
  attnCountActive: { color: Colors.text },
  allClear: { fontSize: FontSize.sm, color: Colors.primaryDark, padding: Spacing.md, fontWeight: '600' },
  bigValue: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  empty: { fontSize: FontSize.sm, color: Colors.textMuted, paddingVertical: Spacing.md },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 2, marginTop: 2 },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 1 },
  barAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  axisText: { fontSize: FontSize.xs, color: Colors.textMuted },
  orderRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 52,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  pill: {
    fontSize: FontSize.xs, fontWeight: '700', borderRadius: Radius.full, paddingHorizontal: Spacing.sm,
    paddingVertical: 2, overflow: 'hidden',
  },
  orderTotal: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, minWidth: 64, textAlign: 'right' },
  cardLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  cardLinkText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primaryDark },
});

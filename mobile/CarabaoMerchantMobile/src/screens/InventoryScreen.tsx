// src/screens/InventoryScreen.tsx
// S7 (plan §5.8): the farm's stock (web merchant shell inventory page): the stock table
// with +/− and an inline editor, the low-stock threshold box, the three alert groups the
// server ranks (low stock, best-before soon, expired) and the province demand insight.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl,
  ActivityIndicator, TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, ApiError, type ApiProduce, type ApiStockAlerts, type ApiStockAlertItem } from '../lib/api';
import { useMerchantData } from '../lib/MerchantDataContext';
import {
  alertCounts, unmetSearches, type DemandInsight, type DemandTerm,
} from '../lib/dashboard';
import {
  DEFAULT_LOW_STOCK_THRESHOLD, daysLabel, inventoryTotals, sortStock, stepStock,
  stockProblem, stockStatus, stockStatusLabel, thresholdProblem, type StockStatus,
} from '../lib/inventory';
import { LISTING_STOCK_MAX } from '../lib/listingForm';
import { formatDate, formatPeso } from '../lib/format';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge, Button } from '../components/UI';
import { SkeletonList, LoadError } from '../components/Skeleton';

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

/** "kg", or "bundle of 3" as the listing names it. */
const unitLabel = (p: Pick<ApiProduce, 'unit' | 'unit_quantity'>) =>
  p.unit_quantity && p.unit_quantity !== 1 ? `${p.unit_quantity} ${p.unit}` : p.unit;

/** The badge colours UI.tsx has; stock has no red, so out of stock is grey. */
const BADGE: Record<StockStatus, 'gray' | 'yellow' | 'green'> = { out: 'gray', low: 'yellow', ok: 'green' };

export default function InventoryScreen() {
  const router = useRouter();
  const { token } = useAuth();
  // The same list the Produce tab edits: a stock change shows there too (S6).
  const { produce, error: produceError, refreshProduce } = useMerchantData();

  const [alerts, setAlerts] = useState<ApiStockAlerts | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [demand, setDemand] = useState<DemandInsight | null>(null);
  const [demandError, setDemandError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // The threshold the page uses: the farm's own once the alerts load, the backend's
  // default (5) before that, exactly as the web page falls back.
  const [savedThreshold, setSavedThreshold] = useState<number | null>(null);
  const [draft, setDraft] = useState(String(DEFAULT_LOW_STOCK_THRESHOLD));
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  // The threshold the farm last loaded or saved. The box follows it until the farm types
  // in it, so a value changed on another device shows here on the next load while a
  // half-typed number is left alone.
  const serverThreshold = useRef<number | null>(null);
  // The box's text as it is now, for the load's comparison (the effect's closure would
  // hold the value from when the request started).
  const draftRef = useRef(String(DEFAULT_LOW_STOCK_THRESHOLD));
  const setDraftText = (v: string) => { draftRef.current = v; setDraft(v); };

  // The row whose stock is saving, and why the last stock change failed.
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);
  const [editing, setEditing] = useState<ApiProduce | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([api.merchants.stockAlerts(token), api.merchants.demand(token)]).then(([a, d]) => {
      if (!active) return;
      if (a.status === 'fulfilled') {
        setAlerts(a.value);
        setAlertsError(null);
        setSavedThreshold(a.value.low_stock_threshold);
        // Untouched (still the default, or still what the server last said): follow it.
        if (serverThreshold.current === null || draftRef.current.trim() === String(serverThreshold.current)) {
          setDraftText(String(a.value.low_stock_threshold));
        }
        serverThreshold.current = a.value.low_stock_threshold;
      } else {
        setAlertsError(errorText(a.reason, 'We couldn’t load your stock alerts.'));
      }
      if (d.status === 'fulfilled') {
        setDemand(d.value);
        setDemandError(null);
      } else {
        setDemandError(errorText(d.reason, 'We couldn’t load what buyers near you want.'));
      }
      setRefreshing(false);
    });
    return () => { active = false; };
  }, [token, attempt]);

  const threshold = savedThreshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
  const rows = useMemo(() => sortStock(produce ?? [], threshold), [produce, threshold]);
  const totals = useMemo(() => inventoryTotals(produce ?? [], threshold), [produce, threshold]);
  const counts = alertCounts(alerts);
  // §5.8 asks for the unmet searches too; the helper ranks them (dashboard-style wording).
  const unmet = useMemo(() => unmetSearches(demand), [demand]);

  const reload = () => setAttempt((n) => n + 1);
  const onRefresh = () => {
    setRefreshing(true);
    reload();
    void refreshProduce();
  };

  const saveThreshold = async () => {
    const problem = thresholdProblem(draft);
    if (problem) { setThresholdError(problem); return; }
    if (!token || savingThreshold) return;
    setSavingThreshold(true);
    setThresholdError(null);
    try {
      // The server answers with the alert groups ranked at the new threshold.
      const next = await api.merchants.setLowStockThreshold(token, Number(draft.trim()));
      setAlerts(next);
      setAlertsError(null);
      setSavedThreshold(next.low_stock_threshold);
      setDraftText(String(next.low_stock_threshold));
      serverThreshold.current = next.low_stock_threshold;
    } catch (err) {
      setThresholdError(errorText(err, 'We couldn’t save the threshold. Please try again.'));
    } finally {
      setSavingThreshold(false);
    }
  };

  const changeStock = async (item: ApiProduce, next: number) => {
    if (!token || busyId !== null || next === item.stock_quantity) return;
    setBusyId(item.id);
    setRowError(null);
    setEditError(null);
    try {
      // CF-0049: the stock this screen read goes with the change. An order that took
      // stock since answers 409 (reload and look) instead of being silently overwritten.
      await api.produce.update(token, item.id, {
        stock_quantity: next,
        expected_stock_quantity: item.stock_quantity,
      });
      setEditing(null);
      // The Produce tab reads the same list, so both show the server's numbers.
      await refreshProduce();
      // The change moves listings between the alert groups; the server ranks them.
      api.merchants.stockAlerts(token)
        .then((a) => { setAlerts(a); setAlertsError(null); })
        .catch(() => { /* keep the groups shown; pull-to-refresh tries again */ });
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const message = errorText(err, 'We couldn’t change the stock. Please try again.');
      setRowError({ id: item.id, message });
      // A refusal (stock an order took, a listing changed) is fixed on the reloaded
      // list, so the box closes; a connection problem keeps it open to try again.
      if (status > 0 && status < 500) setEditing(null);
      else setEditError(message);
      void refreshProduce();
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = (item: ApiProduce) => {
    setEditDraft(String(item.stock_quantity));
    setEditError(null);
    setRowError(null);
    setEditing(item);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const problem = stockProblem(editDraft);
    if (problem) { setEditError(problem); return; }
    await changeStock(editing, Number(editDraft.trim()));
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>Inventory</Text>
    </View>
  );

  if (produce === null) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        {produceError
          ? <LoadError message={produceError} onRetry={onRefresh} />
          : <SkeletonList label="Loading your inventory" rows={4} />}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.lead}>
          What you have, what is running out or ageing, and what buyers near your farm are looking for.
        </Text>

        <View style={styles.tiles}>
          <View style={styles.tile} accessible accessibilityLabel={`Inventory value ${formatPeso(totals.value)}`}>
            <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{formatPeso(totals.value)}</Text>
            <Text style={styles.tileLabel}>Value (price × stock)</Text>
          </View>
          <View style={styles.tile} accessible accessibilityLabel={`${totals.outOfStock} listings out of stock`}>
            <Text style={[styles.tileValue, totals.outOfStock > 0 && styles.tileWarn]}>{totals.outOfStock}</Text>
            <Text style={styles.tileLabel}>Out of stock</Text>
          </View>
          <View style={styles.tile} accessible accessibilityLabel={`${totals.lowStock} listings low on stock`}>
            <Text style={[styles.tileValue, totals.lowStock > 0 && styles.tileWarn]}>{totals.lowStock}</Text>
            <Text style={styles.tileLabel}>Low (≤ {threshold})</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Stock alerts</Text>
          <Text style={styles.label}>Flag listings with stock at or below</Text>
          <View style={styles.thresholdRow}>
            <TextInput
              style={[styles.thresholdInput, thresholdError ? styles.inputBad : null]}
              value={draft}
              onChangeText={(v) => { setDraftText(v); if (thresholdError) setThresholdError(null); }}
              keyboardType="number-pad"
              maxLength={6}
              editable={!savingThreshold}
              accessibilityLabel="Low-stock threshold"
              accessibilityHint="0 turns low-stock alerts off"
            />
            <Button
              label="Save"
              onPress={() => { void saveThreshold(); }}
              loading={savingThreshold}
              disabled={savedThreshold !== null && draft.trim() === String(savedThreshold)}
              style={styles.thresholdSave}
            />
          </View>
          <Text style={styles.muted}>0 turns low-stock alerts off.</Text>
          {thresholdError ? <Text style={styles.error} accessibilityRole="alert">{thresholdError}</Text> : null}
          {alertsError ? (
            <View style={styles.retryRow}>
              <Text style={[styles.error, styles.flex1]} accessibilityRole="alert">{alertsError}</Text>
              <TouchableOpacity onPress={reload} accessibilityRole="button" accessibilityLabel="Try loading the stock alerts again">
                <Text style={styles.linkText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {alerts && counts.total === 0 ? (
            <Text style={styles.body}>
              No alerts. Every listing is stocked and within its best-before date.
            </Text>
          ) : null}
          {alerts ? (
            <>
              <AlertGroup
                title={`Low stock (${counts.low})`}
                tone="yellow"
                items={alerts.low_stock}
                line={(i) => `${i.stock_quantity} ${i.unit} left`}
              />
              <AlertGroup
                title={`Best-before within ${alerts.expiry_warning_days} days (${counts.expiring})`}
                tone="yellow"
                items={alerts.expiring_soon}
                line={(i) => `best before ${formatDate(i.best_before)} (${daysLabel(i.days_left)})`}
              />
              <AlertGroup
                title={`Expired — hidden from buyers (${counts.expired})`}
                tone="red"
                items={alerts.expired}
                line={(i) => `best before ${formatDate(i.best_before)}; update the dates or remove it`}
              />
            </>
          ) : !alertsError ? (
            <SkeletonList label="Loading stock alerts" rows={2} />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Stock by produce</Text>
          {rows.length === 0 ? (
            <Text style={styles.body}>
              No listings yet.{' '}
              <Text
                style={styles.linkText}
                onPress={() => router.push('/(tabs)/produce')}
                accessibilityRole="link"
              >
                Add your first produce on the Produce tab.
              </Text>
            </Text>
          ) : (
            rows.map((p, index) => {
              const status = stockStatus(p.stock_quantity, threshold);
              const busy = busyId === p.id;
              const locked = busyId !== null;
              const name = p.name ?? 'Untitled listing';
              const atMax = p.stock_quantity >= LISTING_STOCK_MAX;
              const failed = rowError?.id === p.id ? rowError.message : null;
              return (
                <View key={p.id} style={[styles.stockRow, index === 0 && styles.stockRowFirst]}>
                  <View style={styles.stockTop}>
                    <View style={styles.flex1}>
                      <Text style={styles.stockName} numberOfLines={2}>{name}</Text>
                      <Text style={styles.muted}>
                        {formatPeso(p.price)} / {unitLabel(p)}{p.category ? ` · ${p.category}` : ''}
                      </Text>
                      <Text style={styles.muted}>Worth {formatPeso(p.price * p.stock_quantity)}</Text>
                    </View>
                    <Badge label={stockStatusLabel(status)} color={BADGE[status]} />
                  </View>
                  <View style={styles.stepper}>
                    <TouchableOpacity
                      style={[styles.step, (locked || p.stock_quantity === 0) && styles.stepOff]}
                      onPress={() => { void changeStock(p, stepStock(p.stock_quantity, -1)); }}
                      disabled={locked || p.stock_quantity === 0}
                      accessibilityRole="button"
                      accessibilityLabel={`One ${p.unit} less of ${name}, now ${p.stock_quantity}`}
                    >
                      <Ionicons name="remove" size={20} color={locked || p.stock_quantity === 0 ? Colors.textLight : Colors.text} />
                    </TouchableOpacity>
                    {/* The middle shows the stock and opens the box to type an exact number. */}
                    <TouchableOpacity
                      style={styles.stockValue}
                      onPress={() => openEdit(p)}
                      disabled={locked}
                      accessibilityRole="button"
                      accessibilityLabel={`Set the stock of ${name}, now ${p.stock_quantity} ${p.unit}`}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                      ) : (
                        <>
                          <Text style={styles.stockValueText}>{p.stock_quantity} {p.unit}</Text>
                          <Ionicons name="create-outline" size={14} color={Colors.textMuted} />
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.step, (locked || atMax) && styles.stepOff]}
                      onPress={() => { void changeStock(p, stepStock(p.stock_quantity, 1)); }}
                      disabled={locked || atMax}
                      accessibilityRole="button"
                      accessibilityLabel={`One ${p.unit} more of ${name}, now ${p.stock_quantity}`}
                    >
                      <Ionicons name="add" size={20} color={locked || atMax ? Colors.textLight : Colors.text} />
                    </TouchableOpacity>
                  </View>
                  {failed ? <Text style={styles.error} accessibilityRole="alert">{failed}</Text> : null}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Demand in {demand?.province ?? 'your province'}</Text>
          {demandError ? (
            <View style={styles.retryRow}>
              <Text style={[styles.error, styles.flex1]} accessibilityRole="alert">{demandError}</Text>
              <TouchableOpacity onPress={reload} accessibilityRole="button" accessibilityLabel="Try loading demand again">
                <Text style={styles.linkText}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {demand ? (
            <>
              <Text style={styles.muted}>
                Last {demand.days} days, all farms in your province. Counts only; no farm or buyer is shown.
              </Text>
              <Text style={styles.sub}>Most ordered</Text>
              {demand.most_ordered.length === 0 ? (
                <Text style={styles.muted}>No paid orders from farms in {demand.province} yet.</Text>
              ) : (
                demand.most_ordered.map((m) => (
                  <Text key={m.name} style={styles.row}>
                    {m.name} — {m.orders} order{m.orders === 1 ? '' : 's'}, {m.quantity} units
                  </Text>
                ))
              )}
              <Text style={styles.sub}>Most searched in {demand.province}</Text>
              <SearchRows rows={demand.most_searched} empty={`No searches filtered to ${demand.province} yet.`} />
              <Text style={styles.sub}>Most searched across Luzon</Text>
              <SearchRows rows={demand.most_searched_luzon} empty="No searches yet." />
              {unmet.length > 0 ? (
                <>
                  <Text style={styles.sub}>Searched, but no one lists it</Text>
                  {unmet.map((t) => (
                    <Text key={t.query} style={styles.row}>
                      “{t.query}” · {t.no_result_searches} searches found nothing
                    </Text>
                  ))}
                </>
              ) : null}
              <Text style={styles.muted}>
                “Found nothing” means buyers searched and no listing matched: a gap you could fill.
              </Text>
            </>
          ) : !demandError ? (
            <SkeletonList label="Loading what buyers want" rows={2} />
          ) : null}
        </View>

        <Text style={styles.footnote}>
          Stock here is what buyers can order. Expired listings stay hidden until you update their dates on the Produce tab.
        </Text>
      </ScrollView>

      <Modal
        visible={editing !== null}
        animationType="slide"
        transparent
        onRequestClose={() => { if (busyId === null) setEditing(null); }}
      >
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Stock of {editing?.name ?? 'this listing'}</Text>
            <Text style={styles.label}>How many {editing ? unitLabel(editing) : 'units'} do you have?</Text>
            <TextInput
              style={[styles.input, editError ? styles.inputBad : null]}
              value={editDraft}
              onChangeText={(v) => { setEditDraft(v); if (editError) setEditError(null); }}
              keyboardType="number-pad"
              maxLength={String(LISTING_STOCK_MAX).length}
              editable={busyId === null}
              autoFocus
              selectTextOnFocus
              accessibilityLabel="Stock quantity"
            />
            {editError ? <Text style={styles.error} accessibilityRole="alert">{editError}</Text> : null}
            <Text style={styles.muted}>Saving replaces the stock your buyers see right away.</Text>
            <Button
              label="Save stock"
              onPress={() => { void saveEdit(); }}
              loading={busyId !== null}
              fullWidth
              style={styles.sheetSave}
            />
            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => setEditing(null)}
              disabled={busyId !== null}
              accessibilityRole="button"
            >
              <Text style={styles.sheetCancelText}>{busyId !== null ? 'Saving…' : 'Cancel'}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// The web StockAlertsPanel's groups: the heading with its count, then the rows in the
// order the server ranked them. An empty group draws nothing, as on the web.
function AlertGroup({
  title, tone, items, line,
}: {
  title: string;
  tone: 'yellow' | 'red';
  items: ApiStockAlertItem[];
  line: (item: ApiStockAlertItem) => string;
}) {
  if (items.length === 0) return null;
  const red = tone === 'red';
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {items.map((i) => (
        <View key={i.id} style={[styles.groupItem, { backgroundColor: red ? Colors.errorBg : Colors.warningBg }]}>
          <View style={[styles.dot, { backgroundColor: red ? Colors.error : Colors.warning }]} />
          <View style={styles.flex1}>
            <Text style={styles.groupName}>{i.name}</Text>
            <Text style={styles.muted}>{line(i)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

// The web DemandInsight list: "query — 3 searches · 2 found nothing".
function SearchRows({ rows, empty }: { rows: DemandTerm[]; empty: string }) {
  if (rows.length === 0) return <Text style={styles.muted}>{empty}</Text>;
  return (
    <>
      {rows.map((s) => (
        <Text key={s.query} style={styles.row}>
          {s.query} — {s.searches} search{s.searches === 1 ? '' : 'es'}
          {s.no_result_searches > 0 ? (
            <Text style={styles.warnText}> · {s.no_result_searches} found nothing</Text>
          ) : null}
        </Text>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { padding: Spacing.xs },
  headerTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  lead: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  tiles: { flexDirection: 'row', gap: Spacing.sm },
  tile: { flex: 1, backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.md, gap: 2, ...Shadow.sm },
  tileValue: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  tileWarn: { color: Colors.warning },
  tileLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  card: { backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.sm },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  thresholdRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  thresholdInput: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: FontSize.md,
    color: Colors.text, backgroundColor: Colors.white,
  },
  thresholdSave: { paddingVertical: 10, paddingHorizontal: Spacing.lg },
  inputBad: { borderColor: Colors.error, backgroundColor: Colors.errorBg },
  muted: { fontSize: FontSize.sm, color: Colors.textMuted },
  error: { fontSize: FontSize.sm, color: Colors.error },
  retryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  linkText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primaryDark },
  body: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  sub: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginTop: Spacing.xs },
  row: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  warnText: { color: Colors.warning },
  group: { gap: Spacing.xs, marginTop: Spacing.xs },
  groupTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  groupItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    borderRadius: Radius.sm, padding: Spacing.sm,
  },
  dot: { width: 8, height: 8, borderRadius: Radius.full, marginTop: 5 },
  groupName: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  stockRow: {
    borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: Spacing.md,
    marginTop: Spacing.sm, gap: Spacing.xs,
  },
  stockRowFirst: { borderTopWidth: 0, paddingTop: 0, marginTop: 0 },
  stockTop: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  stockName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  step: {
    width: 40, height: 40, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white,
  },
  stepOff: { backgroundColor: Colors.borderLight },
  stockValue: {
    flex: 1, minHeight: 40, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
  },
  stockValueText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  flex1: { flex: 1 },
  footnote: { fontSize: FontSize.xs, color: Colors.textLight, lineHeight: 18, paddingHorizontal: Spacing.xs },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17, 24, 39, 0.45)' },
  sheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
    padding: Spacing.xl, gap: Spacing.sm,
  },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12, fontSize: FontSize.md,
    color: Colors.text, backgroundColor: Colors.white,
  },
  sheetSave: { marginTop: Spacing.xs },
  sheetCancel: { alignItems: 'center', paddingVertical: Spacing.md },
  sheetCancelText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
});


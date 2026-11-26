// src/screens/ShipmentsScreen.tsx
// S11 (plan §5.4, part 1): the Shipments screen, the merchant copy of the web
// `M/(shell)/shipments/page.tsx` + `M/components/ShipmentsTab.tsx`. It offers the orders
// that are ready to ship with checkboxes (at most MAX_SHIPMENT_ORDERS per route), makes one
// route with "Make route", lists the shipments the farm has, and opens a shipment's route
// (`/route?shipmentId=<id>`, S12). The pure rules live in src/lib/shipments.ts; the orders
// and their poll come from MerchantDataContext, so the ready count badge follows a create.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Modal, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../lib/AuthContext';
import { useMerchantData } from '../lib/MerchantDataContext';
import {
  api,
  type ApiMerchantOrder,
  type MerchantShipmentSummary,
  type MerchantShipmentTracking,
} from '../lib/api';
import { formatDate, formatPeso } from '../lib/format';
import {
  ACTIVE_SHIPMENTS_TITLE,
  CLEAR_LABEL,
  COMPLETED_SHIPMENTS_TITLE,
  GO_TO_ORDERS,
  MAKE_ROUTE_LABEL,
  MAKING_ROUTE_LABEL,
  MAX_SHIPMENT_ORDERS,
  NO_ADDRESS,
  NO_SHIPMENTS,
  NOTHING_TO_SHIP,
  OPEN_ROUTE_LABEL,
  PAST_PAGE,
  READY_TO_SHIP_HINT,
  READY_TO_SHIP_TITLE,
  ROUTING_LABEL,
  SELECTION_FULL_MESSAGE,
  SHIPMENTS_LEAD,
  SHIPMENTS_LOAD_ERROR,
  SHIPMENT_CREATE_ERROR,
  SKIPPED_KEPT_NOTE,
  applySelection,
  createdSummary,
  itemsLabel,
  progressPercent,
  readyCountLabel,
  readyGroups,
  readyToShipOrders,
  selectAllLabel,
  selectedIds,
  selectionCountLabel,
  showMoreLabel,
  skipNotes,
  splitShipments,
  stopsCompletedLabel,
  stopsLabel,
  toggleOrder,
  type ReadyGroup,
  type SelectionChange,
} from '../lib/shipments';
import { missingPackingPhotos } from '../lib/orderActions';
import { takeProofPhoto } from '../lib/proofCapture';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge, Button, Card } from '../components/UI';
import { SkeletonList, LoadError } from '../components/Skeleton';

const PACKING_PHOTO_ERROR = 'The packing photo could not be sent. Try again.';

/** One ready order: the whole row is the checkbox, as the web wraps it in a <label>. */
function ReadyRow({
  order,
  checked,
  blocked,
  photoBusy,
  onToggle,
  onPhoto,
}: {
  order: ApiMerchantOrder;
  checked: boolean;
  /** The cap is reached, so the row cannot be picked (the tap says why). */
  blocked: boolean;
  /** The packing photo of this order is uploading. */
  photoBusy: boolean;
  onToggle: () => void;
  /** Take (or retake) the packing photo: a route takes only orders with one. */
  onPhoto: () => void;
}) {
  const itemCount = order.items.length;
  return (
    <TouchableOpacity
      style={[styles.readyRow, checked && styles.readyRowChecked, blocked && styles.readyRowBlocked]}
      onPress={onToggle}
      activeOpacity={0.8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: blocked }}
      accessibilityLabel={`Order ${order.id}, ${order.buyer_name ?? 'no buyer name'}`}
    >
      <View style={[styles.box, checked && styles.boxOn]}>
        {checked && <Ionicons name="checkmark" size={16} color={Colors.white} />}
      </View>
      <View style={styles.readyMain}>
        <View style={styles.readyTop}>
          <Text style={styles.readyId}>#{order.id}</Text>
          <Text style={styles.readyBuyer} numberOfLines={1}>{order.buyer_name ?? '—'}</Text>
          <Text style={styles.readyTotal}>{formatPeso(order.total_price)}</Text>
        </View>
        <Text style={styles.readyAddress} numberOfLines={1}>
          {order.delivery_address ?? NO_ADDRESS}
        </Text>
        <Text style={styles.readyWhen}>
          Ordered {formatDate(order.ordered_at)} · {itemsLabel(itemCount)}
        </Text>
        <TouchableOpacity
          style={[styles.photoBtn, order.packing_photo && styles.photoBtnDone, photoBusy && styles.readyRowBlocked]}
          onPress={onPhoto}
          disabled={photoBusy}
          accessibilityRole="button"
          accessibilityLabel={`${packingPhotoLabel(order.packing_photo === true, photoBusy)}, order ${order.id}`}
        >
          <Ionicons
            name={order.packing_photo ? 'checkmark-circle' : 'camera-outline'}
            size={16}
            color={order.packing_photo ? Colors.primaryDark : Colors.text}
          />
          <Text style={styles.photoBtnText}>
            {packingPhotoLabel(order.packing_photo === true, photoBusy)}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

function packingPhotoLabel(taken: boolean, busy: boolean): string {
  if (busy) return 'Sending photo…';
  return taken ? 'Packing photo taken · Retake' : 'Take packing photo';
}

/** One shipment row: "Shipment #12", its progress and the button to its route. */
function ShipmentRow({
  shipment,
  onOpen,
}: {
  shipment: MerchantShipmentSummary;
  onOpen: () => void;
}) {
  const { completed_stop_count: done, stop_count: total } = shipment;
  return (
    <View style={styles.shipmentRow}>
      <View style={styles.shipmentHead}>
        <Text style={styles.shipmentTitle}>Shipment #{shipment.id}</Text>
        <Text style={styles.shipmentMeta}>{formatDate(shipment.created_at)}</Text>
      </View>
      <View
        style={styles.progressTrack}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={stopsCompletedLabel(done, total)}
      >
        <View style={[styles.progressFill, { width: `${progressPercent(done, total)}%` }]} />
      </View>
      <View style={styles.shipmentFoot}>
        <Text style={styles.shipmentMeta}>{stopsLabel(done, total)}</Text>
        <TouchableOpacity
          style={styles.smallBtn}
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${ROUTING_LABEL} shipment ${shipment.id}`}
        >
          <Text style={styles.smallBtnText}>{ROUTING_LABEL}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ShipmentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { orders, loading, error, refreshOrders } = useMerchantData();

  const [shipments, setShipments] = useState<MerchantShipmentSummary[]>([]);
  const [shipmentsLoading, setShipmentsLoading] = useState(true);
  const [shipmentsError, setShipmentsError] = useState<string | null>(null);
  // Bumped to ask for the list again (a pull, a retry, a create); the effect below loads it.
  const [shipmentsAttempt, setShipmentsAttempt] = useState(0);
  const [pastShown, setPastShown] = useState(PAST_PAGE);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** The shipment just made: the result sheet lists the stops it had to leave out. */
  const [created, setCreated] = useState<MerchantShipmentTracking | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The order whose packing photo is uploading (one at a time).
  const [photoBusyId, setPhotoBusyId] = useState<number | null>(null);

  const ready =useMemo(() => readyToShipOrders(orders ?? []), [orders]);
  const readyIds = useMemo(() => new Set(ready.map((o) => o.id)), [ready]);
  // The web keeps the raw picks and filters them to what is still ready; count and post the
  // filtered set only, so an order that shipped elsewhere can never be sent again.
  const current = useMemo(
    () => new Set([...selected].filter((id) => readyIds.has(id))),
    [selected, readyIds],
  );
  const groups = useMemo(() => readyGroups(ready), [ready]);
  const { active, past } = useMemo(() => splitShipments(shipments), [shipments]);
  const skipped = created?.skipped_orders ?? [];
  const notes = skipNotes(skipped);

  // Like EarningsScreen and InventoryScreen: the effect asks, the answer lands in `.then`, so
  // a reload is a counter bump (a setState in an effect body would cascade renders).
  const reloadShipments = useCallback(() => {
    setShipmentsError(null);
    setShipmentsLoading(true);
    setShipmentsAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    api.merchants
      .shipments(token)
      .then((list) => {
        if (!active) return;
        setShipments(list);
        setShipmentsError(null);
      })
      .catch(() => {
        if (active) setShipmentsError(SHIPMENTS_LOAD_ERROR);
      })
      .finally(() => {
        if (!active) return;
        setShipmentsLoading(false);
        setRefreshing(false);
      });
    return () => { active = false; };
  }, [token, shipmentsAttempt]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    reloadShipments();
    // The ready list comes from the context (it polls); this makes the pull load it too.
    void refreshOrders();
  }, [refreshOrders, reloadShipments]);

  /**
   * Pick rows, or take them off. A pick past the cap changes nothing and says why, instead
   * of a checkbox that silently does not respond (the web disables its 21st checkbox).
   */
  const pick = (ids: number[], select: boolean) => {
    const change: SelectionChange = applySelection(selected, readyIds, ids, select);
    setSelected(change.selected);
    setCreateError(change.refused > 0 ? SELECTION_FULL_MESSAGE : null);
  };

  const toggle = (id: number) => {
    const change = toggleOrder(selected, readyIds, id);
    setSelected(change.selected);
    setCreateError(change.refused > 0 ? SELECTION_FULL_MESSAGE : null);
  };

  const clear = () => {
    setSelected(new Set());
    setCreateError(null);
  };

  const openRoute = (shipmentId: number) => {
    setCreated(null);
    // S12 draws the map from this id.
    router.push({ pathname: '/route', params: { shipmentId: String(shipmentId) } });
  };

  // ORDER_PROOF_PHOTOS_PLAN.md: each order needs its own packing photo before it ships.
  const takePackingPhoto = async (order: ApiMerchantOrder) => {
    if (photoBusyId !== null) return;
    setPhotoBusyId(order.id);
    try {
      const photo = await takeProofPhoto('packing');
      if (!photo) return;
      await api.merchants.packingPhoto(token, order.id, photo);
      await refreshOrders();
    } catch (err) {
      // An alert: the action bar (where createError shows) is there only while rows are picked.
      Alert.alert('Packing photo', err instanceof Error && err.message ? err.message : PACKING_PHOTO_ERROR);
    } finally {
      setPhotoBusyId(null);
    }
  };

  const makeRoute = async () => {
    const ids = selectedIds(current);
    if (ids.length === 0 || creating) return;
    const missing = missingPackingPhotos(ready, ids);
    if (missing.length > 0) {
      setCreateError(`Take a packing photo of each order first. No photo: ${missing.map((id) => `#${id}`).join(', ')}`);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const tracking = await api.merchants.createShipment(token, ids);
      setSelected(new Set());
      setCreated(tracking);
      // The orders are on a route now: reload them so the ready list, and the Shipments
      // badge the tab bar and the More menu draw, no longer count them.
      await refreshOrders();
      reloadShipments();
    } catch (err) {
      // A 429 is the `shipment_create` limit (30 an hour per farm); the server's message
      // says when to try again, so show it as it comes.
      setCreateError(err instanceof Error && err.message ? err.message : SHIPMENT_CREATE_ERROR);
    } finally {
      setCreating(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shipments</Text>
        {ready.length > 0 && <Badge label={readyCountLabel(ready.length)} color="blue" />}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 120 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.lead}>{SHIPMENTS_LEAD}</Text>

        {/* ── Ready to ship ── */}
        <Card style={styles.panel}>
          <Text style={styles.panelTitle}>{READY_TO_SHIP_TITLE}</Text>
          <Text style={styles.hint}>{READY_TO_SHIP_HINT}</Text>

          {loading && !orders ? (
            <SkeletonList label="Loading orders…" rows={3} />
          ) : orders === null ? (
            <LoadError
              message={error ?? 'Could not load your orders.'}
              onRetry={onRefresh}
            />
          ) : ready.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Text style={styles.emptyText}>{NOTHING_TO_SHIP}</Text>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => router.push('/orders')}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryBtnText}>{GO_TO_ORDERS}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            groups.map((group: ReadyGroup) => {
              const ids = group.orders.map((o) => o.id);
              const picked = ids.filter((id) => current.has(id)).length;
              const all = picked === ids.length;
              const some = picked > 0 && !all;
              return (
                <View key={group.key} style={styles.group}>
                  {/* The web's group header checkbox: pick every order in the group. */}
                  <TouchableOpacity
                    style={styles.groupHead}
                    onPress={() => pick(ids, !all)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: some ? 'mixed' : all }}
                    accessibilityLabel={selectAllLabel(ids.length, group.label)}
                  >
                    <View style={[styles.box, all && styles.boxOn, some && styles.boxSome]}>
                      {all && <Ionicons name="checkmark" size={16} color={Colors.white} />}
                      {some && <View style={styles.boxDash} />}
                    </View>
                    <Text style={[styles.groupLabel, group.urgent && styles.groupLabelUrgent]}>
                      {group.label}
                    </Text>
                    <Text style={styles.groupCount}>{ids.length}</Text>
                  </TouchableOpacity>
                  {group.orders.map((order) => {
                    const checked = current.has(order.id);
                    return (
                      <ReadyRow
                        key={order.id}
                        order={order}
                        checked={checked}
                        blocked={!checked && current.size >= MAX_SHIPMENT_ORDERS}
                        photoBusy={photoBusyId === order.id}
                        onToggle={() => toggle(order.id)}
                        onPhoto={() => void takePackingPhoto(order)}
                      />
                    );
                  })}
                </View>
              );
            })
          )}
        </Card>
        {/* ── The shipments ── */}
        <Card style={styles.panel}>
          <Text style={styles.panelTitle}>{ACTIVE_SHIPMENTS_TITLE}</Text>
          {shipmentsLoading && shipments.length === 0 ? (
            <SkeletonList label="Loading shipments…" rows={2} />
          ) : shipmentsError ? (
            <LoadError message={shipmentsError} onRetry={reloadShipments} />
          ) : active.length === 0 ? (
            <Text style={styles.emptyText}>{NO_SHIPMENTS}</Text>
          ) : (
            active.map((shipment) => (
              <ShipmentRow
                key={shipment.id}
                shipment={shipment}
                onOpen={() => openRoute(shipment.id)}
              />
            ))
          )}
        </Card>

        {past.length > 0 && (
          <Card style={styles.panel}>
            <Text style={styles.panelTitle}>{COMPLETED_SHIPMENTS_TITLE}</Text>
            {past.slice(0, pastShown).map((shipment) => (
              <ShipmentRow
                key={shipment.id}
                shipment={shipment}
                onOpen={() => openRoute(shipment.id)}
              />
            ))}
            {past.length > pastShown && (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setPastShown((n) => n + PAST_PAGE)}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryBtnText}>{showMoreLabel(past.length - pastShown)}</Text>
              </TouchableOpacity>
            )}
          </Card>
        )}

      </ScrollView>

      {/* The web's sticky bar: only while something is picked. An error or the cap message
          shows here, next to the count it is about. */}
      {current.size > 0 && (
        <View
          style={[styles.actionBar, { paddingBottom: Spacing.md + insets.bottom }]}
          accessibilityRole="region"
          accessibilityLabel="Shipment selection"
        >
          <View style={styles.actionInfo}>
            <Text style={styles.actionCount}>{selectionCountLabel(current.size)}</Text>
            {createError ? <Text style={styles.actionError}>{createError}</Text> : null}
          </View>
          <View style={styles.actionButtons}>
            <TouchableOpacity
              style={styles.ghostBtn}
              onPress={clear}
              disabled={creating}
              accessibilityRole="button"
            >
              <Text style={styles.ghostBtnText}>{CLEAR_LABEL}</Text>
            </TouchableOpacity>
            <Button
              label={creating ? MAKING_ROUTE_LABEL : MAKE_ROUTE_LABEL}
              onPress={() => void makeRoute()}
              loading={creating}
              style={styles.makeBtn}
            />
          </View>
        </View>
      )}

      {/* The result sheet: the stops made, and the ones the server had to leave out. */}
      <Modal
        visible={created !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setCreated(null)}
      >
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { paddingBottom: Spacing.lg + insets.bottom }]}>
            <ScrollView contentContainerStyle={styles.sheetBody}>
              <Text style={styles.sheetTitle}>{created ? createdSummary(created) : ''}</Text>
              {notes.map((note) => (
                <Text key={note.reason} style={styles.sheetLine}>{note.text}</Text>
              ))}
              {skipped.length > 0 && <Text style={styles.hint}>{SKIPPED_KEPT_NOTE}</Text>}
              {created && (
                <Button
                  label={OPEN_ROUTE_LABEL}
                  onPress={() => openRoute(created.shipment_id)}
                  fullWidth
                  style={styles.sheetBtn}
                />
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.cancel}
              onPress={() => setCreated(null)}
              accessibilityRole="button"
            >
              <Text style={styles.cancelText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { padding: Spacing.xs },
  headerTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md },
  lead: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  panel: { gap: Spacing.sm },
  panelTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17 },
  emptyBlock: { alignItems: 'flex-start', gap: Spacing.sm, paddingVertical: Spacing.xs },
  emptyText: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  secondaryBtn: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.white,
    alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primaryDark },
  group: { gap: 6, marginTop: Spacing.xs },
  groupHead: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.xs, minHeight: 40,
  },
  box: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.white,
  },
  boxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  boxSome: { borderColor: Colors.primary },
  boxDash: { width: 10, height: 2, backgroundColor: Colors.primary },
  groupLabel: { flex: 1, fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  groupLabelUrgent: { color: Colors.error },
  groupCount: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted },
  readyRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    padding: Spacing.md, backgroundColor: Colors.white, minHeight: 44,
  },
  readyRowChecked: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  readyRowBlocked: { opacity: 0.5 },
  readyMain: { flex: 1, gap: 2 },
  readyTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  readyId: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  readyBuyer: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  readyTotal: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  readyAddress: { fontSize: FontSize.xs, color: Colors.textMuted },
  readyWhen: { fontSize: FontSize.xs, color: Colors.textMuted },
  photoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: Spacing.xs, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm, minHeight: 36, backgroundColor: Colors.white,
  },
  photoBtnDone: { borderColor: Colors.primary },
  photoBtnText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.text },
  shipmentRow: {
    gap: 6, borderWidth: 1, borderColor: Colors.borderLight, borderRadius: Radius.md,
    padding: Spacing.md, backgroundColor: Colors.white,
  },
  shipmentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  shipmentTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  shipmentMeta: { fontSize: FontSize.xs, color: Colors.textMuted },
  progressTrack: { height: 6, borderRadius: Radius.full, backgroundColor: Colors.borderLight, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.primary },
  shipmentFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  smallBtn: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 6, minHeight: 36, justifyContent: 'center',
  },
  smallBtnText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primaryDark },
  actionBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0, gap: Spacing.xs,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border,
    ...Shadow.lg,
  },
  actionInfo: { gap: 2 },
  actionCount: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  actionError: { fontSize: FontSize.xs, color: Colors.error, lineHeight: 17 },
  actionButtons: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  ghostBtn: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, minHeight: 44,
    justifyContent: 'center',
  },
  ghostBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted },
  makeBtn: { flex: 1, paddingHorizontal: Spacing.md },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17, 24, 39, 0.45)' },
  sheet: {
    maxHeight: '75%', backgroundColor: Colors.white, borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.lg,
  },
  sheetBody: { gap: Spacing.sm },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, lineHeight: 24 },
  sheetLine: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  sheetBtn: { marginTop: Spacing.sm },
  cancel: { alignItems: 'center', paddingVertical: Spacing.sm, minHeight: 44, justifyContent: 'center' },
  cancelText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
});


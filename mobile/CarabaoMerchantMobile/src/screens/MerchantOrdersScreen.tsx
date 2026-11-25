// src/screens/MerchantOrdersScreen.tsx
// S4 (plan §5.2): the Orders tab, matching the web merchant sales page — status
// filter chips, an order sheet with the moves the server allows
// (src/lib/orderActions.ts), cancel with a reason, and `orders?order=<id>` from a
// notification opens that order. The orders come from MerchantDataContext, which
// polls them; `refreshOrders()` updates them (and the tab badges) after a change.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity,
  RefreshControl, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiMerchantOrder, type MerchantOrderStatus } from '../lib/api';
import { useMerchantData } from '../lib/MerchantDataContext';
import {
  needsPhoto, orderCounts, orderFilter, orderFilterLabel, ORDER_FILTERS,
  type MerchantCancelReason, type OrderFilterKey,
} from '../lib/orderActions';
import { takeProofAtAddress, takeProofPhoto } from '../lib/proofCapture';
import { orderStatusColor, orderStatusLabel } from '../lib/orderStatus';
import { formatPeso, formatRequestedDate } from '../lib/format';
import { parseOrderId } from '../lib/orderChat';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge, EmptyState } from '../components/UI';
import { SkeletonList, LoadError } from '../components/Skeleton';
import { CancelOrderSheet } from '../components/CancelOrderSheet';
import { OrderDetailSheet } from '../components/OrderDetailSheet';

function OrderRow({
  order, focused, onOpen,
}: {
  order: ApiMerchantOrder;
  focused: boolean;
  onOpen: () => void;
}) {
  // The web OrderCard counts lines, not quantities.
  const itemCount = order.items.length;
  const refund = order.payment_status === 'refund_pending' || order.payment_status === 'refunded';
  return (
    <TouchableOpacity
      style={[styles.card, focused && styles.cardFocused]}
      onPress={onOpen}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.id}`}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.orderId}>#{order.id}</Text>
        <Badge label={orderStatusLabel(order.status)} color={orderStatusColor(order.status)} />
        {refund && (
          <Badge label={order.payment_status === 'refunded' ? 'Refunded' : 'Refund pending'} color="gray" />
        )}
        <Text style={styles.total}>{formatPeso(order.total_price)}</Text>
        <Ionicons name="chevron-forward" size={18} color={Colors.textLight} />
      </View>
      {/* The web OrderCard summary line: buyer · requested date · items. */}
      <Text style={styles.summary}>
        {order.buyer_name ?? '—'} ·{' '}
        {order.requested_delivery_date ? formatRequestedDate(order.requested_delivery_date) : 'Any day'} ·{' '}
        {itemCount} item{itemCount === 1 ? '' : 's'}
      </Text>
      {order.notes ? (
        <Text style={styles.note} numberOfLines={1}>Note: {order.notes}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function MerchantOrdersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ order?: string }>();
  const { token } = useAuth();
  const { orders, loading, error, refreshOrders } = useMerchantData();
  const [filter, setFilter] = useState<OrderFilterKey>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Set when a notification or a link names an order: scroll to it and highlight it.
  const [focusId, setFocusId] = useState<number | null>(null);
  const listRef = useRef<FlatList<ApiMerchantOrder>>(null);
  const handledOrder = useRef<number | null>(null);

  const counts = useMemo(() => orderCounts(orders ?? []), [orders]);
  const visible = useMemo(() => orderFilter(orders ?? [], filter), [orders, filter]);
  const detail = useMemo(() => orders?.find((o) => o.id === detailId) ?? null, [orders, detailId]);

  // S4: carabaomerchant://orders?order=12 — or a new_order notification — opens that
  // order. The param is cleared once used, so coming back to the tab shows the list.
  useEffect(() => {
    const id = parseOrderId(params.order);
    if (id === null) {
      handledOrder.current = null;
      return;
    }
    if (!orders) return;
    if (handledOrder.current === id) {
      // Already opened (the orders reloaded under it): just drop the param.
      router.setParams({ order: undefined });
      return;
    }
    const order = orders.find((o) => o.id === id);
    // Not in this farm's orders (yet): leave the param, the next poll may have it.
    if (!order) return;
    // Deferred: opening the sheet is a state change, which an effect body must not
    // make synchronously (react-hooks/set-state-in-effect). A poll re-render clears
    // this timer and schedules again.
    const t = setTimeout(() => {
      handledOrder.current = id;
      setFilter('all');
      setDetailId(id);
      setFocusId(id);
      router.setParams({ order: undefined });
    }, 0);
    return () => clearTimeout(t);
  }, [params.order, orders, router]);

  useEffect(() => {
    if (focusId === null) return;
    const index = visible.findIndex((o) => o.id === focusId);
    if (index >= 0) {
      const t = setTimeout(() => {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      }, 100);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [focusId, visible]);

  // The highlight fades, as the web's focused card does.
  useEffect(() => {
    if (focusId === null) return undefined;
    const t = setTimeout(() => setFocusId(null), 2500);
    return () => clearTimeout(t);
  }, [focusId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshOrders();
    setRefreshing(false);
  };

  const send = async (order: ApiMerchantOrder, to: Exclude<MerchantOrderStatus, 'cancelled'>) => {
    setBusyId(order.id);
    try {
      await api.merchants.updateOrderStatus(token, order.id, to);
      await refreshOrders();
    } catch (err) {
      Alert.alert('Could not update order', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  // ORDER_PROOF_PHOTOS_PLAN.md: shipping needs a packing photo from the live camera. The
  // status changes only when the upload succeeds.
  const shipWithPhoto = async (order: ApiMerchantOrder) => {
    setBusyId(order.id);
    try {
      const photo = await takeProofPhoto('packing');
      if (!photo) return;
      await api.merchants.shipOrder(token, order.id, photo);
      await refreshOrders();
    } catch (err) {
      Alert.alert('Could not ship order', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const advance = (order: ApiMerchantOrder, to: MerchantOrderStatus) => {
    if (to === 'cancelled') {
      // Cancelling needs a reason, so its own sheet replaces the detail one.
      setDetailId(null);
      setCancelId(order.id);
      return;
    }
    if (to === 'shipped') {
      // The camera opens over the screen, not over the sheet (iOS presents one modal at a time).
      setDetailId(null);
      Alert.alert('Ship order', `Take a photo of packed order #${order.id}. Then it is marked shipped.`, [
        { text: 'Back', style: 'cancel' },
        { text: 'Take photo', onPress: () => void shipWithPhoto(order) },
      ]);
      return;
    }
    Alert.alert('Update order', `Move order #${order.id} to "${orderStatusLabel(to)}"?`, [
      { text: 'Back', style: 'cancel' },
      { text: 'Confirm', onPress: () => void send(order, to) },
    ]);
  };

  const cancelling = useMemo(() => orders?.find((o) => o.id === cancelId) ?? null, [orders, cancelId]);
  const cancelNeedsPhoto = cancelling != null && needsPhoto(cancelling.status, 'cancelled');

  const cancelOrder = async (reason: MerchantCancelReason, note: string) => {
    if (cancelId == null) return;
    // Errors are thrown back to the sheet, which shows them.
    if (cancelNeedsPhoto) {
      const proof = await takeProofAtAddress('attempt');
      if (!proof) throw new Error('No photo was taken, so the order is not cancelled.');
      await api.merchants.attemptCancel(token, cancelId, proof.photo, proof.position, reason, note);
    } else {
      await api.merchants.cancelOrder(token, cancelId, reason, note);
    }
    await refreshOrders();
    setCancelId(null);
  };

  const openChat = (order: ApiMerchantOrder) => {
    setDetailId(null);
    router.push({
      pathname: '/order-chat',
      params: { orderId: String(order.id), title: `Chat with ${order.buyer_name ?? 'buyer'}` },
    });
  };

  let body: React.ReactNode;
  if (loading && !orders) {
    body = <SkeletonList label="Loading incoming orders" rows={4} />;
  } else if (orders === null) {
    body = <LoadError message={error ?? 'Could not load your orders.'} onRetry={() => void onRefresh()} />;
  } else {
    body = (
      <FlatList
        ref={listRef}
        data={visible}
        keyExtractor={(o) => String(o.id)}
        renderItem={({ item }) => (
          <OrderRow order={item} focused={focusId === item.id} onOpen={() => setDetailId(item.id)} />
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
        }}
        ListHeaderComponent={
          <View style={styles.filters}>
            {ORDER_FILTERS.map((key) => {
              const active = filter === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setFilter(key)}
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {orderFilterLabel(key)} {counts[key]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={<Ionicons name="receipt-outline" size={48} color={Colors.textLight} />}
            title={filter === 'all' ? 'No orders yet' : `No ${orderFilterLabel(filter).toLowerCase()} orders`}
            message="Paid orders from buyers appear here."
          />
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.navBar}>
        {/* A tab root has no screen behind it, so it has no Back button. */}
        <Text style={styles.navTitle}>Incoming orders</Text>
      </View>
      {body}
      <OrderDetailSheet
        order={detail}
        busy={detail != null && busyId === detail.id}
        onClose={() => setDetailId(null)}
        onChat={() => detail && openChat(detail)}
        onAdvance={(to) => detail && advance(detail, to)}
        onCancel={() => detail && advance(detail, 'cancelled')}
      />
      <CancelOrderSheet
        orderId={cancelId}
        withPhoto={cancelNeedsPhoto}
        onClose={() => setCancelId(null)}
        onSubmit={cancelOrder}
      />
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  navTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  list: { padding: Spacing.lg, gap: Spacing.sm, flexGrow: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  chipTextActive: { color: Colors.white },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  // The web highlights the order a link or a review named (orderCardFocused).
  cardFocused: { borderColor: Colors.primary, borderWidth: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  orderId: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  total: { marginLeft: 'auto', fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  summary: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 6 },
  note: { fontSize: FontSize.sm, color: Colors.text, marginTop: 4, fontStyle: 'italic' },
});

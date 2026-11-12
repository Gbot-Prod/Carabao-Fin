// src/screens/MerchantOrdersScreen.tsx
// Incoming orders for a merchant. Same endpoints as the web merchant dashboard:
// GET /merchants/me/orders and PATCH /merchants/me/orders/{id}/status.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, ApiError, type ApiMerchantOrder, type MerchantOrderStatus } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge, EmptyState } from '../components/UI';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { SkeletonList, LoadError } from '../components/Skeleton';

const STATUS_LABELS: Record<MerchantOrderStatus, string> = {
  pending: 'Awaiting payment',
  processing: 'Preparing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

// Mirrors MERCHANT_TRANSITIONS in backend/app/services/order_status.py; the
// server enforces it, this only decides which buttons to show.
const NEXT_STEPS: Partial<Record<MerchantOrderStatus, { to: MerchantOrderStatus; label: string }[]>> = {
  processing: [{ to: 'shipped', label: 'Mark shipped' }],
  shipped: [{ to: 'out_for_delivery', label: 'Out for delivery' }],
};
const CANCELLABLE: MerchantOrderStatus[] = ['processing', 'shipped', 'out_for_delivery'];

const FILTERS: { key: 'open' | 'all' | MerchantOrderStatus; label: string }[] = [
  { key: 'open', label: 'To do' },
  { key: 'all', label: 'All' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

const peso = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(n);

function badgeColor(status: MerchantOrderStatus): 'green' | 'blue' | 'yellow' | 'gray' {
  if (status === 'delivered') return 'green';
  if (status === 'shipped' || status === 'out_for_delivery') return 'blue';
  if (status === 'processing') return 'yellow';
  return 'gray';
}

function OrderRow({
  order, busy, onUpdate, onChat,
}: {
  order: ApiMerchantOrder;
  busy: boolean;
  onUpdate: (order: ApiMerchantOrder, to: MerchantOrderStatus) => void;
  onChat: (order: ApiMerchantOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const itemCount = order.items.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
  const steps = NEXT_STEPS[order.status] ?? [];
  const canCancel = CANCELLABLE.includes(order.status);
  const refund = order.payment_status === 'refund_pending' || order.payment_status === 'refunded';

  return (
    <View style={styles.card}>
      <TouchableOpacity onPress={() => setOpen((v) => !v)} activeOpacity={0.8} accessibilityRole="button">
        <View style={styles.cardHeader}>
          <Text style={styles.orderId}>#{order.id}</Text>
          <Badge label={STATUS_LABELS[order.status]} color={badgeColor(order.status)} />
          {refund && <Badge label={order.payment_status === 'refunded' ? 'Refunded' : 'Refund pending'} color="gray" />}
          <Text style={styles.total}>{peso(order.total_price)}</Text>
        </View>
        <Text style={styles.summary}>
          {order.buyer_name ?? 'Buyer'} · {itemCount} item{itemCount === 1 ? '' : 's'} ·{' '}
          {order.requested_delivery_date ?? 'Any day'}
          {order.delivery_window ? `, ${order.delivery_window}` : ''}
        </Text>
        {order.notes ? <Text style={styles.note} numberOfLines={open ? undefined : 1}>Note: {order.notes}</Text> : null}
      </TouchableOpacity>

      {open && (
        <View style={styles.details}>
          {order.items.map((item, i) => (
            <Text key={i} style={styles.detailText}>
              {item.name ?? item.produce_name ?? `Item ${i + 1}`} × {item.quantity ?? 0}
              {typeof item.price === 'number' ? ` · ${peso(item.price)}` : ''}
            </Text>
          ))}
          {order.delivery_address ? <Text style={styles.detailMuted}>Deliver to: {order.delivery_address}</Text> : null}
          {order.buyer_phone ? <Text style={styles.detailMuted}>Phone: {order.buyer_phone}</Text> : null}
          <Text style={styles.detailMuted}>Ordered {new Date(order.ordered_at).toLocaleString('en-PH')}</Text>
          <TouchableOpacity style={styles.chatLink} onPress={() => onChat(order)}>
            <Text style={styles.chatLinkText}>Message buyer</Text>
          </TouchableOpacity>
        </View>
      )}

      {(steps.length > 0 || canCancel) && (
        <View style={styles.actions}>
          {steps.map((step) => (
            <TouchableOpacity
              key={step.to}
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => onUpdate(order, step.to)}
            >
              <Text style={styles.primaryBtnText}>{step.label}</Text>
            </TouchableOpacity>
          ))}
          {canCancel && (
            <TouchableOpacity
              style={[styles.cancelBtn, busy && styles.btnDisabled]}
              disabled={busy}
              onPress={() => onUpdate(order, 'cancelled')}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          )}
          {busy && <ActivityIndicator color={Colors.primary} />}
        </View>
      )}
    </View>
  );
}

function MerchantOrdersContent() {
  const router = useRouter();
  const { token } = useAuth();
  const [orders, setOrders] = useState<ApiMerchantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notMerchant, setNotMerchant] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('open');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setOrders(await api.merchants.myOrders(token));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setNotMerchant(true);
      else setError(err instanceof Error ? err.message : 'Could not load your orders');
    }
  }, [token]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const send = async (order: ApiMerchantOrder, to: MerchantOrderStatus) => {
    setBusyId(order.id);
    try {
      const updated = await api.merchants.updateOrderStatus(token, order.id, to);
      setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    } catch (err) {
      Alert.alert('Could not update order', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const onUpdate = (order: ApiMerchantOrder, to: MerchantOrderStatus) => {
    const message =
      to === 'cancelled'
        ? 'The buyer will be refunded by Carabao and the stock returned to your listing.'
        : `Move order #${order.id} to "${STATUS_LABELS[to]}"?`;
    Alert.alert(to === 'cancelled' ? `Cancel order #${order.id}?` : 'Update order', message, [
      { text: 'Back', style: 'cancel' },
      {
        text: to === 'cancelled' ? 'Cancel order' : 'Confirm',
        style: to === 'cancelled' ? 'destructive' : 'default',
        onPress: () => void send(order, to),
      },
    ]);
  };

  const visible = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'open') return orders.filter((o) => CANCELLABLE.includes(o.status));
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  let body: React.ReactNode;
  if (loading) {
    body = <SkeletonList label="Loading incoming orders" rows={4} />;
  } else if (notMerchant) {
    body = (
      <EmptyState
        icon={<Ionicons name="storefront-outline" size={48} color={Colors.textLight} />}
        title="Not a merchant yet"
        message="Register as a merchant to receive orders."
      />
    );
  } else if (error) {
    body = (
      <LoadError
        message={error}
        onRetry={() => {
          setLoading(true);
          void load().finally(() => setLoading(false));
        }}
      />
    );
  } else {
    body = (
      <FlatList
        data={visible}
        keyExtractor={(o) => String(o.id)}
        renderItem={({ item }) => (
          <OrderRow
            order={item}
            busy={busyId === item.id}
            onUpdate={onUpdate}
            onChat={(o) =>
              router.push({
                pathname: '/order-chat',
                params: { orderId: String(o.id), title: `Chat with ${o.buyer_name ?? 'buyer'}` },
              })
            }
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f.key}
                style={[styles.chip, filter === f.key && styles.chipActive]}
                onPress={() => setFilter(f.key)}
                accessibilityState={{ selected: filter === f.key }}
              >
                <Text style={[styles.chipText, filter === f.key && styles.chipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={<Ionicons name="receipt-outline" size={48} color={Colors.textLight} />}
            title={filter === 'open' ? 'Nothing to do' : 'No orders here'}
            message="Paid orders from buyers appear here."
          />
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Incoming orders</Text>
        <View style={{ width: 22 }} />
      </View>
      {body}
    </SafeAreaView>
  );
}

export default function MerchantOrdersScreen() {
  return (
    <ProtectedScreen>
      <MerchantOrdersContent />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backIcon: { fontSize: 22, color: Colors.text },
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
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  orderId: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  total: { marginLeft: 'auto', fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  summary: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 6 },
  note: { fontSize: FontSize.sm, color: Colors.text, marginTop: 4, fontStyle: 'italic' },
  details: { marginTop: Spacing.md, gap: 4, borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: Spacing.md },
  detailText: { fontSize: FontSize.sm, color: Colors.text },
  detailMuted: { fontSize: FontSize.xs, color: Colors.textMuted },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  primaryBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  cancelBtn: {
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.error,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  cancelBtnText: { color: Colors.error, fontWeight: '700', fontSize: FontSize.sm },
  btnDisabled: { opacity: 0.5 },
  chatLink: { marginTop: Spacing.sm, alignSelf: 'flex-start' },
  chatLinkText: { color: Colors.primary, fontWeight: '700', fontSize: FontSize.sm },
});

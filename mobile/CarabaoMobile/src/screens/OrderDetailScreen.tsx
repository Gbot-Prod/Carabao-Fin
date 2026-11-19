// src/screens/OrderDetailScreen.tsx
// CF-0105: one buyer order (web orders/[orderId]): items, totals from the server,
// delivery details, cancel while preparing, confirm when it arrives, review if left.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, Alert, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, ApiError, type ApiOrderDetail } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge } from '../components/UI';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { SkeletonList, LoadError } from '../components/Skeleton';
import { orderStatusColor, orderStatusLabel } from '../lib/orderStatus';
import { orderActions, orderRef, parseOrderId } from '../lib/orderDetail';

type Load = { kind: 'ok'; order: ApiOrderDetail } | { kind: 'notFound' } | { kind: 'error'; message: string };

function fetchOrder(token: string | null, id: number): Promise<Load> {
  return api.orders
    .detail(token, id)
    .then((order): Load => ({ kind: 'ok', order }))
    .catch((err: unknown): Load =>
      err instanceof ApiError && err.status === 404
        ? { kind: 'notFound' }
        : { kind: 'error', message: err instanceof Error ? err.message : 'Could not load this order' },
    );
}

const peso = (n: number) =>
  new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(n);

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function OrderDetailContent() {
  const router = useRouter();
  const { token } = useAuth();
  const params = useLocalSearchParams<{ orderId?: string }>();
  const orderId = parseOrderId(params.orderId);

  const [load, setLoad] = useState<Load | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (orderId === null) return;
    let active = true;
    void fetchOrder(token, orderId).then((r) => { if (active) setLoad(r); });
    return () => { active = false; };
  }, [token, orderId]);

  const reload = useCallback(async () => {
    if (orderId === null) return;
    setLoad(await fetchOrder(token, orderId));
  }, [token, orderId]);

  const runAction = (title: string, message: string, confirmLabel: string, destructive: boolean, call: () => Promise<unknown>) => {
    Alert.alert(title, message, [
      { text: 'Not now', style: 'cancel' },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: async () => {
          setBusy(true);
          try {
            await call();
          } catch (err) {
            Alert.alert(title, err instanceof Error ? err.message : 'Please try again.');
          } finally {
            await reload(); // show the status the server now has, also after a refusal
            setBusy(false);
          }
        },
      },
    ]);
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Order details</Text>
    </View>
  );

  if (orderId === null || load?.kind === 'notFound') {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <View style={styles.center}>
          <Ionicons name="search-outline" size={44} color={Colors.textLight} />
          <Text style={styles.centerTitle}>Order not found</Text>
          <Text style={styles.centerSub}>It may belong to another account, or the link is wrong.</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (load === null) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <SkeletonList label="Loading order" rows={3} />
      </SafeAreaView>
    );
  }
  if (load.kind === 'error') {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <LoadError message={load.message} onRetry={() => { setLoad(null); void reload(); }} />
      </SafeAreaView>
    );
  }

  const order = load.order;
  const actions = orderActions(order.status);
  const ref = orderRef(order.order_id, order.date_bought);
  const schedule = [order.requested_delivery_date, order.delivery_window].filter(Boolean).join(' · ');

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await reload();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={styles.card}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.ref} selectable>{ref}</Text>
              <Text style={styles.farm}>{order.merchant}</Text>
              <Text style={styles.muted}>Ordered {formatDate(order.date_bought)}</Text>
            </View>
            <Badge label={orderStatusLabel(order.status)} color={orderStatusColor(order.status)} />
          </View>
          {order.status === 'pending' && (
            <Text style={styles.note}>
              We haven’t received payment for this order yet. The farm starts preparing it once you pay; unpaid
              orders are cancelled automatically and the items go back on sale.
            </Text>
          )}
          {order.status === 'delivered' && order.delivered_at && (
            <Text style={styles.note}>
              Delivered {formatDate(order.delivered_at)}
              {order.delivery_confirmed_by === 'buyer' ? ' · confirmed by you' : ''}
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items</Text>
          {order.items.map((item, i) => (
            <View key={`${item.id}-${i}`} style={styles.row}>
              <Text style={[styles.rowLabel, { flex: 1 }]}>
                {item.produce} · {item.quantity} {item.unit}
              </Text>
              <Text style={styles.rowValue}>{peso(item.price * item.quantity)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <Row label="Delivery fee" value={peso(order.delivery_fee)} />
          <View style={styles.row}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{peso(order.total_amount)}</Text>
          </View>
        </View>

        {(order.delivery_address || schedule || order.notes) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Delivery</Text>
            {order.delivery_address ? <Row label="Address" value={order.delivery_address} /> : null}
            {schedule ? <Row label="Requested" value={schedule} /> : null}
            {order.notes ? <Row label="Notes" value={order.notes} /> : null}
          </View>
        )}

        {order.review && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your review</Text>
            <Text style={styles.stars} accessibilityLabel={`${order.review.rating} out of 5 stars`}>
              {'★'.repeat(order.review.rating)}{'☆'.repeat(Math.max(0, 5 - order.review.rating))}
            </Text>
            {order.review.comment ? <Text style={styles.reviewText}>{order.review.comment}</Text> : null}
          </View>
        )}
        {!order.review && order.can_review && (
          <Text style={styles.muted}>
            You can review this order on the website
            {order.review_deadline ? ` until ${formatDate(order.review_deadline)}` : ''}.
          </Text>
        )}

        <View style={styles.actions}>
          {actions.canConfirm && (
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              disabled={busy}
              onPress={() =>
                runAction(
                  'Order received',
                  'Confirm you received this order? This releases payment to the farm.',
                  'Yes, I received it',
                  false,
                  () => api.orders.confirmReceived(token, order.order_id),
                )
              }
            >
              <Text style={styles.btnPrimaryText}>Order received</Text>
            </TouchableOpacity>
          )}
          {actions.canConfirm && order.auto_confirm_at && (
            <Text style={styles.muted}>
              Confirms by itself on {formatDate(order.auto_confirm_at)} if you don’t confirm or contact support.
            </Text>
          )}
          {actions.canTrack && (
            <TouchableOpacity style={styles.btn} onPress={() => router.push('/(tabs)/track')}>
              <Text style={styles.btnText}>Live tracking</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.btn}
            onPress={() =>
              router.push({
                pathname: '/order-chat',
                params: { orderId: String(order.order_id), title: `Chat with ${order.merchant}` },
              })
            }
          >
            <Text style={styles.btnText}>Message farm</Text>
          </TouchableOpacity>
          {actions.canCancel && (
            <TouchableOpacity
              style={[styles.btn, styles.btnDanger]}
              disabled={busy}
              onPress={() =>
                runAction(
                  'Cancel order',
                  'Cancel this order? The farm has not shipped it yet. Your payment goes to the refund queue.',
                  'Cancel order',
                  true,
                  () => api.orders.cancel(token, order.order_id),
                )
              }
            >
              <Text style={styles.btnDangerText}>Cancel order</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function OrderDetailScreen() {
  return (
    <ProtectedScreen>
      <OrderDetailContent />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 60 },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  ref: { fontSize: FontSize.sm, color: Colors.textMuted, fontFamily: 'monospace' },
  farm: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  muted: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  note: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  cardTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md },
  rowLabel: { fontSize: FontSize.sm, color: Colors.textMuted },
  rowValue: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.xs },
  totalLabel: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  totalValue: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary },
  stars: { fontSize: FontSize.lg, color: Colors.warning },
  reviewText: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  actions: { gap: Spacing.sm },
  btn: {
    minHeight: 48, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary, backgroundColor: Colors.white,
  },
  btnText: { color: Colors.primary, fontWeight: '700', fontSize: FontSize.md },
  btnPrimary: { backgroundColor: Colors.primary },
  btnPrimaryText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },
  btnDanger: { borderColor: Colors.error },
  btnDangerText: { color: Colors.error, fontWeight: '700', fontSize: FontSize.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  centerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  centerSub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
});

// src/screens/TrackScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiCurrentOrder, type ApiTracking } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge, Divider } from '../components/UI';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { SkeletonList, LoadError } from '../components/Skeleton';
import {
  ORDER_TIMELINE_STEPS, orderStatusColor, orderStatusLabel, timelineIndex,
} from '../lib/orderStatus';

function StatusTimeline({ status }: { status: string }) {
  const idx = timelineIndex(status);

  // Cancelled (or an unrecognised status) isn't a point on the progress line.
  if (idx === -1) {
    return (
      <View style={tl.notice}>
        <Ionicons
          name={status === 'cancelled' ? 'close-circle-outline' : 'help-circle-outline'}
          size={20}
          color={status === 'cancelled' ? Colors.error : Colors.textMuted}
        />
        <Text style={tl.noticeText}>
          {status === 'cancelled'
            ? 'This order was cancelled. If you paid, the refund is handled by Carabao.'
            : `Status: ${orderStatusLabel(status)}`}
        </Text>
      </View>
    );
  }

  return (
    <View style={tl.container}>
      {ORDER_TIMELINE_STEPS.map(({ label: step }, i) => {
        const done = i <= idx;
        const active = i === idx;
        return (
          <View key={step} style={tl.stepRow}>
            <View style={tl.lineCol}>
              <View style={[tl.dot, done && tl.dotDone, active && tl.dotActive]}>
                {done && (
                  <Ionicons
                    name={i < idx ? 'checkmark' : 'ellipse'}
                    size={i < idx ? 12 : 8}
                    color={i < idx ? Colors.success : Colors.white}
                  />
                )}
              </View>
              {i < ORDER_TIMELINE_STEPS.length - 1 && (
                <View style={[tl.line, i < idx && tl.lineDone]} />
              )}
            </View>
            <View style={tl.stepContent}>
              <Text style={[tl.stepText, done && tl.stepTextDone, active && tl.stepTextActive]}>
                {step}
              </Text>
              {active && <Text style={tl.stepSub}>Current status</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function OrderCard({
  order, isSelected, onPress,
}: { order: ApiCurrentOrder; isSelected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.orderCard, isSelected && styles.orderCardSelected]}
    >
      <View style={styles.orderCardRow}>
        <View style={[styles.orderThumb, isSelected && styles.orderThumbSelected]}>
          <Ionicons
            name="cube-outline"
            size={24}
            color={isSelected ? Colors.primary : Colors.textMuted}
          />
        </View>
        <View style={styles.orderCardInfo}>
          <Text style={styles.orderMerchant}>{order.merchant}</Text>
          <Text style={styles.orderDate}>Ordered: {order.date_bought}</Text>
          <Text style={styles.orderDate}>
            ETA: {order.shipped ? (order.time_of_arrival ?? 'TBD') : 'Pending shipment'}
          </Text>
        </View>
        <Badge label={orderStatusLabel(order.status)} color={orderStatusColor(order.status)} />
      </View>
    </TouchableOpacity>
  );
}

function TrackScreenContent() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<ApiCurrentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await api.orders.current(token);
        setOrders(data);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [token, attempt]);

  const selected = orders[selectedIdx];
  const [tracking, setTracking] = useState<ApiTracking | null>(null);

  useEffect(() => {
    setTracking(null);
    if (!selected) return;
    let active = true;
    api.tracking
      .forOrder(token, selected.order_id)
      .then((data) => { if (active) setTracking(data); })
      .catch(() => { /* leave the "waiting for shipment" state */ });
    return () => { active = false; };
  }, [token, selected]);

  const hasEstimate =
    tracking?.tracking_state === 'estimated' && tracking.eta_minutes !== null;
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(n);

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Track Orders</Text>
        </View>
        <SkeletonList label="Loading your deliveries" rows={2} />
      </SafeAreaView>
    );
  }

  if (failed && orders.length === 0) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Track Orders</Text>
        </View>
        <LoadError
          message="We couldn't load your deliveries. Check your connection and try again."
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Track Orders</Text>
        <Text style={styles.headerSub}>{orders.length} active order{orders.length !== 1 ? 's' : ''}</Text>
      </View>

      {orders.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="mail-outline" size={48} color={Colors.textLight} />
          <Text style={styles.emptyTitle}>No active orders</Text>
          <Text style={styles.emptySub}>Orders you place will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => String(item.id)}
          ListHeaderComponent={
            selected ? (
              <View style={styles.detailsCard}>
                <Text style={styles.detailCardTitle}>Delivery Details</Text>
                <View style={styles.mapPlaceholder}>
                  <Ionicons name="map-outline" size={36} color={Colors.textLight} />
                  <Text style={styles.mapPlaceholderText}>
                    {hasEstimate ? 'Estimated progress' : 'Waiting for shipment'}
                  </Text>
                  <Text style={styles.mapPlaceholderSub}>
                    {hasEstimate && tracking
                      ? `${Math.round(tracking.progress * 100)}% · about ${tracking.eta_minutes} min to arrival`
                      : 'Estimated progress will appear after the merchant dispatches this order.'}
                  </Text>
                </View>

                <View style={styles.detailsGrid}>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>MERCHANT</Text>
                    <Text style={styles.detailValue}>{selected.merchant}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>DATE BOUGHT</Text>
                    <Text style={styles.detailValue}>{selected.date_bought}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>STATUS</Text>
                    <Text style={[styles.detailValue, { color: Colors.primary }]}>{orderStatusLabel(selected.status)}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>ESTIMATED ARRIVAL</Text>
                    <Text style={styles.detailValue}>
                      {selected.shipped ? (selected.time_of_arrival ?? 'TBD') : 'Pending'}
                    </Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>DELIVERY FEE</Text>
                    <Text style={styles.detailValue}>{fmt(selected.delivery_fee)}</Text>
                  </View>
                </View>

                <Divider />
                <Text style={styles.timelineTitle}>Order Progress</Text>
                <StatusTimeline status={selected.status} />
                <Divider />
                <Text style={[styles.timelineTitle, { marginBottom: Spacing.sm }]}>Your Orders</Text>
              </View>
            ) : null
          }
          renderItem={({ item, index }) => (
            <View style={{ paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm }}>
              <OrderCard
                order={item}
                isSelected={selectedIdx === index}
                onPress={() => setSelectedIdx(index)}
              />
            </View>
          )}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

export default function TrackScreen() {
  return (
    <ProtectedScreen>
      <TrackScreenContent />
    </ProtectedScreen>
  );
}

const tl = StyleSheet.create({
  container: { paddingVertical: Spacing.sm },
  stepRow: { flexDirection: 'row', gap: Spacing.md },
  lineCol: { alignItems: 'center', width: 24 },
  dot: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.border, borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dotDone: { backgroundColor: Colors.successBg, borderColor: Colors.success },
  dotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  line: { width: 2, height: 24, backgroundColor: Colors.border, marginVertical: 2 },
  lineDone: { backgroundColor: Colors.success },
  stepContent: { flex: 1, paddingBottom: 20 },
  stepText: { fontSize: FontSize.sm, color: Colors.textMuted },
  stepTextDone: { color: Colors.text, fontWeight: '500' },
  stepTextActive: { color: Colors.primary, fontWeight: '700' },
  stepSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginVertical: Spacing.sm, padding: Spacing.md,
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.md,
  },
  noticeText: { flex: 1, fontSize: FontSize.sm, color: Colors.textMuted },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },

  header: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  headerSub: { fontSize: FontSize.sm, color: Colors.textMuted },

  detailsCard: {
    backgroundColor: Colors.white, margin: Spacing.lg,
    borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.md,
  },
  detailCardTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },

  mapPlaceholder: {
    height: 160, backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
    marginBottom: Spacing.lg, gap: 4,
  },
  mapPlaceholderText: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textMuted },
  mapPlaceholderSub: { fontSize: FontSize.xs, color: Colors.textLight },

  detailsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md,
  },
  detailItem: {
    width: '47%', backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  detailLabel: { fontSize: 10, color: Colors.textMuted, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  detailValue: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '700' },

  timelineTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted },

  orderCard: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.border, ...Shadow.sm,
  },
  orderCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  orderCardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  orderThumb: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  orderThumbSelected: { backgroundColor: Colors.white },
  orderCardInfo: { flex: 1 },
  orderMerchant: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  orderDate: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
});

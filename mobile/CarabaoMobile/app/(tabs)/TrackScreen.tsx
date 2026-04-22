// src/screens/TrackScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, SafeAreaView, Image,
} from 'react-native';
import { mockOrders } from '../lib/mockData';
import { Order } from '../types';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge, Card, Divider, StatRow } from '../components/UI';

const STATUS_STEPS = ['Order Placed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered'];

function StatusTimeline({ status }: { status: string }) {
  const currentIdx = STATUS_STEPS.findIndex((s) =>
    s.toLowerCase() === status.toLowerCase()
  );
  const idx = currentIdx === -1 ? 1 : currentIdx;

  return (
    <View style={tl.container}>
      {STATUS_STEPS.map((step, i) => {
        const done = i <= idx;
        const active = i === idx;
        return (
          <View key={step} style={tl.stepRow}>
            <View style={tl.lineCol}>
              <View style={[tl.dot, done && tl.dotDone, active && tl.dotActive]}>
                {done && <Text style={tl.dotCheck}>{i < idx ? '✓' : '●'}</Text>}
              </View>
              {i < STATUS_STEPS.length - 1 && (
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

function OrderCard({ order, isSelected, onPress }: { order: Order; isSelected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[styles.orderCard, isSelected && styles.orderCardSelected]}
    >
      <View style={styles.orderCardRow}>
        <Image source={{ uri: order.image }} style={styles.orderThumb} />
        <View style={styles.orderCardInfo}>
          <Text style={styles.orderMerchant}>{order.merchant}</Text>
          <Text style={styles.orderDate}>Ordered: {order.dateBought}</Text>
          <Text style={styles.orderDate}>
            ETA: {order.shipped ? order.timeOfArrival : 'Pending shipment'}
          </Text>
        </View>
        <Badge
          label={order.status}
          color={
            order.status === 'Delivered' ? 'green'
              : order.status === 'Shipped' ? 'blue'
                : 'yellow'
          }
        />
      </View>
    </TouchableOpacity>
  );
}

export default function TrackScreen() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const selected = mockOrders[selectedIdx];

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(n);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Track Orders</Text>
        <Text style={styles.headerSub}>{mockOrders.length} active orders</Text>
      </View>

      <FlatList
        data={mockOrders}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.detailsCard}>
            <Text style={styles.detailCardTitle}>Delivery Details</Text>
            <View style={styles.mapPlaceholder}>
              <Text style={styles.mapPlaceholderIcon}>🗺️</Text>
              <Text style={styles.mapPlaceholderText}>Live map tracking</Text>
              <Text style={styles.mapPlaceholderSub}>Tap to open in Maps app</Text>
            </View>

            <View style={styles.detailsGrid}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>MERCHANT</Text>
                <Text style={styles.detailValue}>{selected.merchant}</Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>DATE BOUGHT</Text>
                <Text style={styles.detailValue}>{selected.dateBought}</Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>STATUS</Text>
                <Text style={[styles.detailValue, { color: Colors.primary }]}>{selected.status}</Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>ESTIMATED ARRIVAL</Text>
                <Text style={styles.detailValue}>
                  {selected.shipped ? selected.timeOfArrival : 'Pending'}
                </Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>DELIVERY FEE</Text>
                <Text style={styles.detailValue}>{fmt(selected.deliveryFee)}</Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>ORDER TOTAL</Text>
                <Text style={styles.detailValue}>{fmt(selected.totalAmount)}</Text>
              </View>
            </View>

            <Divider />
            <Text style={styles.timelineTitle}>Order Progress</Text>
            <StatusTimeline status={selected.status} />

            <Divider />
            <Text style={[styles.timelineTitle, { marginBottom: Spacing.sm }]}>Select Order</Text>
          </View>
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
    </SafeAreaView>
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
  dotCheck: { fontSize: 11, color: Colors.success, fontWeight: '800' },
  line: { width: 2, height: 24, backgroundColor: Colors.border, marginVertical: 2 },
  lineDone: { backgroundColor: Colors.success },
  stepContent: { flex: 1, paddingBottom: 20 },
  stepText: { fontSize: FontSize.sm, color: Colors.textMuted },
  stepTextDone: { color: Colors.text, fontWeight: '500' },
  stepTextActive: { color: Colors.primary, fontWeight: '700' },
  stepSub: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
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
  mapPlaceholderIcon: { fontSize: 36 },
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

  orderCard: {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.border, ...Shadow.sm,
  },
  orderCardSelected: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  orderCardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  orderThumb: { width: 52, height: 52, borderRadius: Radius.md },
  orderCardInfo: { flex: 1 },
  orderMerchant: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  orderDate: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
});

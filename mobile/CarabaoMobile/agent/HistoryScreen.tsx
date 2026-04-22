// src/screens/HistoryScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, SafeAreaView,
} from 'react-native';
import { mockOrders } from '../lib/mockData';
import { Order } from '../types';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge } from '../components/UI';

function HistoryCard({ order }: { order: Order }) {
  const [expanded, setExpanded] = useState(false);
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(n);

  const statusColor = (s: string): 'green' | 'blue' | 'yellow' | 'gray' => {
    if (s === 'Delivered') return 'green';
    if (s === 'Shipped') return 'blue';
    if (s === 'Processing') return 'yellow';
    return 'gray';
  };

  return (
    <TouchableOpacity
      onPress={() => setExpanded((p) => !p)}
      activeOpacity={0.8}
      style={styles.card}
    >
      <View style={styles.cardHeader}>
        <Image source={{ uri: order.image }} style={styles.thumb} />
        <View style={styles.cardInfo}>
          <Text style={styles.merchant}>{order.merchant}</Text>
          <Text style={styles.orderId}>{order.id}</Text>
          <Text style={styles.date}>📅 {order.dateBought}</Text>
        </View>
        <View style={styles.cardRight}>
          <Badge label={order.status} color={statusColor(order.status)} />
          <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </View>

      {expanded && (
        <View style={styles.details}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Order Total</Text>
            <Text style={styles.detailValue}>{fmt(order.totalAmount)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Delivery Fee</Text>
            <Text style={styles.detailValue}>{fmt(order.deliveryFee)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>ETA</Text>
            <Text style={styles.detailValue}>
              {order.shipped ? order.timeOfArrival : 'Pending shipment'}
            </Text>
          </View>
          <TouchableOpacity style={styles.reorderBtn}>
            <Text style={styles.reorderText}>🔁  Reorder</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Order History</Text>
        <Text style={styles.headerSub}>Tap any order for details</Text>
      </View>

      <FlatList
        data={mockOrders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <HistoryCard order={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No orders yet</Text>
            <Text style={styles.emptySub}>Your past orders will appear here</Text>
          </View>
        }
        ListHeaderComponent={
          <View style={styles.summaryBanner}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>{mockOrders.length}</Text>
              <Text style={styles.summaryLabel}>Total Orders</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>
                {mockOrders.filter((o) => o.status === 'Delivered').length}
              </Text>
              <Text style={styles.summaryLabel}>Delivered</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>
                ₱{mockOrders.reduce((s, o) => s + o.totalAmount, 0).toLocaleString()}
              </Text>
              <Text style={styles.summaryLabel}>Total Spent</Text>
            </View>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },

  header: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  headerSub: { fontSize: FontSize.sm, color: Colors.textMuted },

  summaryBanner: {
    flexDirection: 'row', backgroundColor: Colors.white,
    borderRadius: Radius.lg, marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg, marginBottom: Spacing.md,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
    ...Shadow.sm,
  },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryNum: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.primary },
  summaryLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: Colors.border },

  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: 100, gap: Spacing.sm },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden', ...Shadow.sm,
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    gap: Spacing.md, padding: Spacing.md,
  },
  thumb: { width: 56, height: 56, borderRadius: Radius.md },
  cardInfo: { flex: 1, gap: 2 },
  merchant: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  orderId: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace' },
  date: { fontSize: FontSize.xs, color: Colors.textMuted },
  cardRight: { alignItems: 'flex-end', gap: 6 },
  chevron: { fontSize: 11, color: Colors.textLight },

  details: {
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surfaceAlt, padding: Spacing.md, gap: Spacing.sm,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailLabel: { fontSize: FontSize.sm, color: Colors.textMuted },
  detailValue: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  reorderBtn: {
    backgroundColor: Colors.primaryLight, borderRadius: Radius.md,
    paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.sm,
  },
  reorderText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 60, gap: Spacing.sm },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted },
});

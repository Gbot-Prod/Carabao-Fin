// src/screens/HistoryScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiHistoryOrder } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge } from '../components/UI';

function HistoryCard({ order }: { order: ApiHistoryOrder }) {
  const [expanded, setExpanded] = useState(false);
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(n);

  const badgeColor = (s: string): 'green' | 'blue' | 'yellow' | 'gray' => {
    const lower = s.toLowerCase();
    if (lower === 'delivered') return 'green';
    if (lower === 'shipped') return 'blue';
    if (lower === 'processing') return 'yellow';
    return 'gray';
  };

  return (
    <TouchableOpacity onPress={() => setExpanded((p) => !p)} activeOpacity={0.8} style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.thumb}>
          <Ionicons name="receipt-outline" size={22} color={Colors.primary} />
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.merchant}>{order.merchant}</Text>
          <Text style={styles.orderId}>#{order.order_id}</Text>
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={11} color={Colors.textMuted} />
            <Text style={styles.date}> {order.order_date}</Text>
          </View>
        </View>
        <View style={styles.cardRight}>
          <Badge label={order.status} color={badgeColor(order.status)} />
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={Colors.textLight}
          />
        </View>
      </View>

      {expanded && (
        <View style={styles.details}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Order Total</Text>
            <Text style={styles.detailValue}>{fmt(order.total_amount)}</Text>
          </View>
          {order.items?.length > 0 && (
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Items</Text>
              <Text style={styles.detailValue}>{order.items.length} item{order.items.length !== 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<ApiHistoryOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await api.orders.history(token);
        setOrders(data);
      } catch {
        // Show empty state on error
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [token]);

  const totalSpent = orders.reduce((s, o) => s + o.total_amount, 0);
  const delivered = orders.filter((o) => o.status.toLowerCase() === 'delivered').length;

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Order History</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Order History</Text>
        <Text style={styles.headerSub}>Tap any order for details</Text>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <HistoryCard order={item} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>No orders yet</Text>
            <Text style={styles.emptySub}>Your past orders will appear here</Text>
          </View>
        }
        ListHeaderComponent={
          <View style={styles.summaryBanner}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>{orders.length}</Text>
              <Text style={styles.summaryLabel}>Total Orders</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>{delivered}</Text>
              <Text style={styles.summaryLabel}>Delivered</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryNum}>₱{totalSpent.toLocaleString()}</Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 56, height: 56, borderRadius: Radius.md, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, gap: 2 },
  merchant: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  orderId: { fontSize: FontSize.xs, color: Colors.textMuted, fontFamily: 'monospace' },
  dateRow: { flexDirection: 'row', alignItems: 'center' },
  date: { fontSize: FontSize.xs, color: Colors.textMuted },
  cardRight: { alignItems: 'flex-end', gap: 6 },

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
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted },
});

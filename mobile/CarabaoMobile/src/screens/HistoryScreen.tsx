// src/screens/HistoryScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, ScrollView,
  StyleSheet, SafeAreaView, Alert, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { useCart } from '../lib/CartContext';
import { api, type ApiHistoryOrder } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge } from '../components/UI';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { SkeletonList, LoadError } from '../components/Skeleton';
import { orderStatusColor, orderStatusLabel } from '../lib/orderStatus';
import {
  HISTORY_FILTERS, HISTORY_SEARCH_MAX, hasMoreHistory, mergeHistoryPage, type HistoryFilter,
} from '../lib/orderHistory';

function HistoryCard({ order }: { order: ApiHistoryOrder }) {
  const [expanded, setExpanded] = useState(false);
  const { token } = useAuth();
  const { items: cartItems, addItem, updateQuantity } = useCart();
  const [reordering, setReordering] = useState(false);
  const router = useRouter();

  // "Buy again" (U3): the server checks what can still be ordered; the app's
  // cart is local, so its returned lines are copied in.
  const buyAgain = async () => {
    setReordering(true);
    try {
      const res = await api.reorder.order(token, order.order_id);
      for (const added of res.added) {
        const line = res.cart.items.find((l) => Number(l.produce_id ?? l.id) === added.produce_id);
        const id = String(added.produce_id);
        const existing = cartItems.find((i) => i.id === id);
        if (existing) {
          updateQuantity(id, Math.max(existing.quantity, added.quantity));
        } else {
          addItem({
            id,
            produceId: added.produce_id,
            merchantId: line?.merchant_id != null ? Number(line.merchant_id) : null,
            farm: String(line?.farm ?? order.merchant),
            produce: added.name,
            unit: String(line?.unit ?? 'kg'),
            price: added.price,
            deliveryFee: line?.delivery_fee != null ? Number(line.delivery_fee) : null,
          }, added.quantity);
        }
      }
      const lines = [
        res.added.length > 0
          ? `Added ${res.added.length} item${res.added.length === 1 ? '' : 's'} to your cart.`
          : 'None of these items can be ordered right now.',
        ...res.added.filter((a) => a.reduced_from).map((a) => `${a.name}: only ${a.quantity} left.`),
        ...res.unavailable.map((u) => `${u.name}: ${u.reason}.`),
      ];
      Alert.alert('Buy again', lines.join('\n'));
    } catch (err) {
      Alert.alert('Buy again', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setReordering(false);
    }
  };
  const fmt = (n: number) =>
    new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(n);

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
          <Badge label={orderStatusLabel(order.status)} color={orderStatusColor(order.status)} />
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
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <TouchableOpacity style={styles.buyAgain} onPress={buyAgain} disabled={reordering}>
              <Text style={styles.buyAgainText}>{reordering ? 'Adding…' : 'Buy again'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.buyAgain, styles.chatBtn]}
              onPress={() =>
                router.push({
                  pathname: '/order-chat',
                  params: { orderId: String(order.order_id), title: `Chat with ${order.merchant}` },
                })
              }
            >
              <Text style={[styles.buyAgainText, styles.chatBtnText]}>Message farm</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

function HistoryScreenContent() {
  const { token } = useAuth();
  const [filter, setFilter] = useState<HistoryFilter | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [orders, setOrders] = useState<ApiHistoryOrder[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pulled, setPulled] = useState(false);

  // CF-0102: page 1 is loaded for each filter + search + retry. "Loading" is derived
  // from which key was last loaded, so no state is set synchronously in the effect.
  const key = `${filter}|${query}|${attempt}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== key;
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  // Search runs 400 ms after the last key press.
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    api.orders
      .historyPage(token, { page: 1, status: filter, q: query })
      .then((res) => {
        if (!active) return;
        setOrders(res.items);
        setPage(1);
        setTotal(res.total);
        setFailed(false);
      })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => {
        if (!active) return;
        setLoadedKey(key);
        setPulled(false);
      });
    return () => { active = false; };
  }, [token, filter, query, key]);

  const loadMore = () => {
    if (loading || loadingMore || !hasMoreHistory(page, total)) return;
    const startedFor = key;
    const next = page + 1;
    setLoadingMore(true);
    api.orders
      .historyPage(token, { page: next, status: filter, q: query })
      .then((res) => {
        if (keyRef.current !== startedFor) return; // the filter changed while this page loaded
        setOrders((prev) => mergeHistoryPage(prev, res.items, next));
        setPage(next);
        setTotal(res.total);
      })
      .catch(() => { /* the next scroll to the end tries again */ })
      .finally(() => setLoadingMore(false));
  };

  const filtered = filter !== '' || query !== '';
  const clearFilters = () => {
    setFilter('');
    setSearchInput('');
    setQuery('');
  };

  const header = (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Order History</Text>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Order number or farm"
          placeholderTextColor={Colors.textLight}
          maxLength={HISTORY_SEARCH_MAX}
          returnKeyType="search"
          onSubmitEditing={() => setQuery(searchInput.trim())}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search orders by order number or farm"
        />
        {searchInput !== '' && (
          <TouchableOpacity onPress={() => setSearchInput('')} accessibilityLabel="Clear search" hitSlop={12}>
            <Ionicons name="close-circle" size={18} color={Colors.textLight} />
          </TouchableOpacity>
        )}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {HISTORY_FILTERS.map((f) => {
          const on = f.value === filter;
          return (
            <TouchableOpacity
              key={f.value || 'all'}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => setFilter(f.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );

  if (loading && orders.length === 0 && !failed) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <SkeletonList label="Loading order history" rows={4} />
      </SafeAreaView>
    );
  }

  if (failed && orders.length === 0) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <LoadError
          message="We couldn’t load your orders. Check your connection and try again."
          onRetry={() => setAttempt((n) => n + 1)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <FlatList
        data={orders}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <HistoryCard order={item} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={pulled}
            onRefresh={() => {
              setPulled(true);
              setAttempt((n) => n + 1);
            }}
          />
        }
        ListHeaderComponent={
          <View style={styles.countRow}>
            <Text style={styles.countText} accessibilityLiveRegion="polite">
              {total} order{total === 1 ? '' : 's'}{filtered ? ' found' : ''}
            </Text>
            {loading && <ActivityIndicator size="small" color={Colors.primary} />}
          </View>
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.footer} color={Colors.primary} /> : undefined
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>{filtered ? 'No matching orders' : 'No orders yet'}</Text>
            <Text style={styles.emptySub}>
              {filtered ? 'Try another order number, farm or filter.' : 'Your past orders will appear here'}
            </Text>
            {filtered && (
              <TouchableOpacity style={styles.buyAgain} onPress={clearFilters}>
                <Text style={styles.buyAgainText}>Clear filters</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}

export default function HistoryScreen() {
  return (
    <ProtectedScreen>
      <HistoryScreenContent />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  buyAgain: {
    marginTop: Spacing.sm, alignSelf: 'flex-start', backgroundColor: Colors.primary,
    borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  buyAgainText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  chatBtn: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.primary },
  chatBtnText: { color: Colors.primary },
  root: { flex: 1, backgroundColor: Colors.offWhite },

  header: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm,
    backgroundColor: Colors.offWhite, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: FontSize.sm, color: Colors.text, paddingVertical: Spacing.sm },
  chips: { gap: Spacing.sm, paddingTop: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md, minHeight: 36, justifyContent: 'center',
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  chipTextOn: { color: Colors.white },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.md },
  countText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  footer: { paddingVertical: Spacing.lg },

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

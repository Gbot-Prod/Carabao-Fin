// src/screens/SearchScreen.tsx
// CF-0118: produce search with filters, sort and paging (web order page, produce tab).
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView,
  ActivityIndicator, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiProduceSearchResult } from '../lib/api';
import {
  activeFilterCount, CATEGORIES, NO_FILTERS, SEARCH_PAGE_SIZE, SEARCH_Q_MAX, searchQuery, SORTS, type SearchFilters,
} from '../lib/produceSearch';
import { hasMoreHistory as hasMorePages, mergeHistoryPage as mergePage } from '../lib/orderHistory';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { SaveHeart } from '../components/SaveHeart';
import { LoadError } from '../components/Skeleton';

export default function SearchScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const params = useLocalSearchParams<{ q?: string }>();
  const [filters, setFilters] = useState<SearchFilters>({
    ...NO_FILTERS,
    q: typeof params.q === 'string' ? params.q.slice(0, SEARCH_Q_MAX) : '',
  });
  const [typed, setTyped] = useState(filters.q);
  const [showFilters, setShowFilters] = useState(false);
  const [items, setItems] = useState<ApiProduceSearchResult[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [problem, setProblem] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  // Typing waits 400 ms; every other filter applies at once.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === typed ? f : { ...f, q: typed })), 400);
    return () => clearTimeout(t);
  }, [typed]);

  useEffect(() => {
    const r = searchQuery(filters, 1);
    const mine = ++seq.current;
    if ('error' in r) {
      void Promise.resolve().then(() => { if (mine === seq.current) setProblem(r.error); });
      return;
    }
    api.search
      .page(token, r.ok)
      .then((res) => {
        if (mine !== seq.current) return;
        setProblem(null);
        setItems(res.items);
        setTotal(res.total);
        setPage(1);
        setStatus('ready');
      })
      .catch(() => { if (mine === seq.current) setStatus('error'); });
  }, [filters, token]);

  const loadMore = () => {
    if (loadingMore || status !== 'ready' || !hasMorePages(page, total, SEARCH_PAGE_SIZE)) return;
    const r = searchQuery(filters, page + 1);
    if ('error' in r) return;
    const mine = seq.current;
    setLoadingMore(true);
    api.search
      .page(token, r.ok)
      .then((res) => {
        if (mine !== seq.current) return; // filters changed meanwhile
        setItems((prev) => mergePage(prev, res.items, page + 1));
        setTotal(res.total);
        setPage((p) => p + 1);
      })
      .catch(() => { /* scroll again to retry */ })
      .finally(() => setLoadingMore(false));
  };

  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const nFilters = activeFilterCount(filters);
  const chip = (on: boolean, label: string, onPress: () => void) => (
    <TouchableOpacity
      key={label}
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={typed}
            onChangeText={setTyped}
            placeholder="Search produce"
            placeholderTextColor={Colors.textLight}
            maxLength={SEARCH_Q_MAX}
            returnKeyType="search"
            autoFocus={!typed}
            onSubmitEditing={() => set('q', typed)}
            accessibilityLabel="Search produce"
          />
        </View>
        <TouchableOpacity
          style={styles.filterBtn}
          onPress={() => setShowFilters((s) => !s)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showFilters }}
          accessibilityLabel={`Filters${nFilters ? `, ${nFilters} on` : ''}`}
        >
          <Ionicons name="options-outline" size={20} color={Colors.primary} />
          {nFilters > 0 && <Text style={styles.filterCount}>{nFilters}</Text>}
        </TouchableOpacity>
      </View>

      {showFilters && (
        <View style={styles.filters}>
          <Text style={styles.label}>Sort</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {SORTS.map((s) => chip(filters.sort === s.value, s.label, () => set('sort', s.value)))}
          </ScrollView>
          <Text style={styles.label}>Category</Text>
          <View style={styles.row}>
            {chip(filters.category === '', 'All categories', () => set('category', ''))}
            {CATEGORIES.map((c) => chip(filters.category === c, c, () => set('category', c)))}
          </View>
          <View style={[styles.row, { marginTop: Spacing.sm }]}>
            <TextInput
              style={[styles.input, { flex: 1 }]} value={filters.minPrice} onChangeText={(v) => set('minPrice', v)}
              placeholder="Min ₱" placeholderTextColor={Colors.textLight} keyboardType="number-pad" maxLength={7}
              accessibilityLabel="Minimum price in pesos"
            />
            <TextInput
              style={[styles.input, { flex: 1 }]} value={filters.maxPrice} onChangeText={(v) => set('maxPrice', v)}
              placeholder="Max ₱" placeholderTextColor={Colors.textLight} keyboardType="number-pad" maxLength={7}
              accessibilityLabel="Maximum price in pesos"
            />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>In stock</Text>
            <Switch value={filters.inStock} onValueChange={(v) => set('inStock', v)} accessibilityLabel="In stock only" />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchText}>Fresh (best-before not passed)</Text>
            <Switch value={filters.fresh} onValueChange={(v) => set('fresh', v)} accessibilityLabel="Fresh only" />
          </View>
          {nFilters > 0 && (
            <TouchableOpacity onPress={() => setFilters({ ...NO_FILTERS, q: filters.q })} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={styles.reset}>Reset filters</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {problem ? <Text style={styles.problem} accessibilityRole="alert">{problem}</Text> : null}

      {status === 'error' ? (
        <LoadError message="Search is not available right now." onRetry={() => { setStatus('loading'); setFilters((f) => ({ ...f })); }} />
      ) : status === 'loading' ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => String(p.id)}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={<Text style={styles.count} accessibilityLiveRegion="polite">{total} result{total === 1 ? '' : 's'}</Text>}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: Spacing.lg }} color={Colors.primary} /> : undefined}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="leaf-outline" size={44} color={Colors.textLight} />
              <Text style={styles.emptyTitle}>No produce found</Text>
              <Text style={styles.emptySub}>Try other words or fewer filters.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.item}
              onPress={() => router.push({ pathname: '/merchant', params: { farmId: String(item.merchant_id), farmName: item.merchant_name } })}
              accessibilityRole="button"
              accessibilityLabel={`${item.name ?? 'Produce'}, ${item.price} pesos per ${item.unit}, from ${item.merchant_name}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName} numberOfLines={1}>{item.name ?? 'Produce'}</Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {item.merchant_name}{item.merchant_province ? ` · ${item.merchant_province}` : ''}
                </Text>
              </View>
              <Text style={styles.itemPrice}>₱{item.price.toLocaleString()}/{item.unit}</Text>
              <SaveHeart produceId={item.id} name={item.name ?? 'produce'} size={20} />
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44,
    backgroundColor: Colors.offWhite, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md,
  },
  searchInput: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  filterBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  filterCount: { fontSize: FontSize.xs, fontWeight: '800', color: Colors.primary, marginLeft: 2 },
  filters: { backgroundColor: Colors.white, padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  label: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '700', marginTop: Spacing.sm, marginBottom: 4 },
  row: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: Spacing.md, minHeight: 36, justifyContent: 'center', borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  chipTextOn: { color: Colors.white },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md,
    minHeight: 44, fontSize: FontSize.sm, color: Colors.text, backgroundColor: Colors.surfaceAlt,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  switchText: { fontSize: FontSize.sm, color: Colors.text },
  reset: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  problem: { color: Colors.error, fontSize: FontSize.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  count: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginBottom: Spacing.xs },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.white,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
  },
  itemName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  itemMeta: { fontSize: FontSize.xs, color: Colors.textMuted },
  itemPrice: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary },
  empty: { alignItems: 'center', paddingTop: 40, gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted },
});

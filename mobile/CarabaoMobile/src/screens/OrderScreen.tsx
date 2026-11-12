// src/screens/OrderScreen.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, StyleSheet,
  TouchableOpacity, ScrollView, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import FarmCard from '../components/FarmCard';
import { useCart } from '../lib/CartContext';
import { useAuth } from '../lib/AuthContext';
import { api, merchantLocation, type ApiMerchant, type ApiProduceSearchResult } from '../lib/api';
import { type Farm } from '../lib/mockData';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { SkeletonList, LoadError } from '../components/Skeleton';
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600';

function merchantToFarm(m: ApiMerchant): Farm {
  const firstCategory = m.produces.find((p) => p.category)?.category;
  return {
    id: String(m.id),
    name: m.merchant_name,
    category: firstCategory ?? 'Farm Goods',
    location: merchantLocation(m),
    description: m.shop_page?.description ?? '',
    rating: m.rating ?? 0,
    time: m.delivery_time ? `${m.delivery_time} day${m.delivery_time > 1 ? 's' : ''}` : 'N/A',
    deliveryFee: m.delivery_price ?? 0,
    operatingHours: m.operating_hours ?? '',
    contactInfo: m.contact_number,
    image: m.shop_page?.banner_image_url ?? PLACEHOLDER_IMAGE,
  };
}

function OrderScreenContent() {
  const router = useRouter();
  const { itemCount } = useCart();
  const { token } = useAuth();
  const [farms, setFarms] = useState<Farm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  // U5: unread count for the bell, refreshed every minute.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const load = () =>
      api.notifications.list(token).then((r) => { if (active) setUnread(r.unread); }).catch(() => {});
    void load();
    const timer = setInterval(load, 60_000);
    return () => { active = false; clearInterval(timer); };
  }, [token]);

  // U4: followed farms are listed first.
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!token) return;
    api.follows
      .mine(token)
      .then((ids) => setFollowed(new Set(ids.map(String))))
      .catch(() => setFollowed(new Set()));
  }, [token]);
  // U2: produce matching the search box, from the server (debounced).
  const [produceHits, setProduceHits] = useState<ApiProduceSearchResult[]>([]);
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setProduceHits([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      api.search
        .produce(token, q)
        .then((res) => { if (active) setProduceHits(res.items); })
        .catch(() => { if (active) setProduceHits([]); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [search, token]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const merchants = await api.merchants.list(token);
        setFarms(merchants.map(merchantToFarm));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load merchants');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [token, attempt]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(farms.map((f) => f.category)));
    return ['All', ...cats];
  }, [farms]);

  const filtered = useMemo(() => {
    return farms.filter((f) => {
      const matchSearch =
        f.name.toLowerCase().includes(search.toLowerCase()) ||
        f.category.toLowerCase().includes(search.toLowerCase());
      const matchCat = activeCategory === 'All' || f.category === activeCategory;
      return matchSearch && matchCat;
    }).sort((a, b) => Number(followed.has(b.id)) - Number(followed.has(a.id)));
  }, [farms, search, activeCategory, followed]);

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good morning</Text>
          <Text style={styles.headerTitle}>Find Fresh Farms</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        {token ? (
          <TouchableOpacity
            style={styles.cartBtn}
            onPress={() => router.push('/notifications')}
            accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          >
            <Ionicons name="notifications-outline" size={22} color={Colors.primary} />
            {unread > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{unread > 9 ? '9+' : unread}</Text>
              </View>
            )}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.cartBtn} onPress={() => router.push('/(tabs)/cart')}>
          <Ionicons name="cart-outline" size={22} color={Colors.primary} />
          {itemCount > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{itemCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={Colors.textLight} style={{ marginRight: Spacing.sm }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search farms, products..."
          placeholderTextColor={Colors.textLight}
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Category pills — only shown when data is loaded */}
      {!loading && farms.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pillsScroll}
          contentContainerStyle={styles.pills}
        >
          {categories.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.pill, activeCategory === cat && styles.pillActive]}
              onPress={() => setActiveCategory(cat)}
            >
              <Text style={[styles.pillText, activeCategory === cat && styles.pillTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Results count */}
      {!loading && (
        <View style={styles.resultRow}>
          <Text style={styles.resultText}>
            {error ? 'Could not load merchants' : `${filtered.length} farm${filtered.length !== 1 ? 's' : ''} available`}
          </Text>
        </View>
      )}

      {loading ? (
        <SkeletonList label="Loading farms" rows={4} grid />
      ) : error ? (
        <LoadError message={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.cardWrapper}>
              <FarmCard
                farm={item}
                onPress={() =>
                  router.push({
                    pathname: '/merchant',
                    params: { farmId: item.id, farmName: item.name },
                  })
                }
              />
            </View>
          )}
          ListHeaderComponent={
            produceHits.length > 0 ? (
              <View style={styles.hits}>
                <Text style={styles.hitsTitle}>Produce matching “{search.trim()}”</Text>
                {produceHits.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.hitRow}
                    onPress={() =>
                      router.push({
                        pathname: '/merchant',
                        params: { farmId: String(p.merchant_id), farmName: p.merchant_name },
                      })
                    }
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.hitName}>{p.name ?? 'Produce'}</Text>
                      <Text style={styles.hitMeta}>
                        {p.merchant_name}{p.merchant_province ? ` · ${p.merchant_province}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.hitPrice}>₱{p.price.toLocaleString()}/{p.unit}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={styles.hitsTitle}>Farms</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="leaf-outline" size={48} color={Colors.textLight} />
              <Text style={styles.emptyText}>No farms found</Text>
              <Text style={styles.emptySubText}>Try adjusting your search</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

export default function OrderScreen() {
  return <OrderScreenContent />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  greeting: { fontSize: FontSize.sm, color: Colors.textMuted },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  cartBtn: {
    width: 44, height: 44, backgroundColor: Colors.primaryLight,
    borderRadius: 22, alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  cartBadge: {
    position: 'absolute', top: -2, right: -2,
    backgroundColor: Colors.error, width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.white,
  },
  cartBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '800' },

  hits: { width: '100%', marginBottom: Spacing.md, gap: Spacing.xs },
  hitsTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textMuted, marginTop: Spacing.sm },
  hitRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  hitName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  hitMeta: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  hitPrice: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white,
    marginHorizontal: Spacing.lg, marginTop: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, ...Shadow.sm,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: FontSize.md, color: Colors.text },

  // Without flexGrow: 0 a horizontal ScrollView expands to fill the column,
  // and the default alignItems: 'stretch' makes each pill that tall.
  pillsScroll: { flexGrow: 0, flexShrink: 0 },
  pills: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, alignItems: 'center' },
  pill: {
    paddingHorizontal: Spacing.md, paddingVertical: 7,
    backgroundColor: Colors.white, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, marginRight: Spacing.sm,
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '500' },
  pillTextActive: { color: Colors.white, fontWeight: '700' },

  resultRow: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  resultText: { fontSize: FontSize.sm, color: Colors.textMuted },

  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: 100 },
  row: { justifyContent: 'space-between' },
  cardWrapper: { width: '48.5%', marginBottom: Spacing.md },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  loadingText: { fontSize: FontSize.sm, color: Colors.textMuted },

  errorText: { fontSize: FontSize.sm, color: Colors.error, textAlign: 'center', paddingHorizontal: Spacing.xl },

  empty: { alignItems: 'center', paddingTop: 60, gap: Spacing.sm },
  emptyText: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySubText: { fontSize: FontSize.sm, color: Colors.textMuted },
});

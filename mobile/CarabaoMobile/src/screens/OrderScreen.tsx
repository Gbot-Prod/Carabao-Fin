// src/screens/OrderScreen.tsx
import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, StyleSheet,
  TouchableOpacity, ScrollView, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import FarmCard from '../components/FarmCard';
import { useCart } from '../lib/CartContext';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiMerchant } from '../lib/api';
import { type Farm } from '../lib/mockData';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600';

function merchantToFarm(m: ApiMerchant): Farm {
  return {
    id: String(m.id),
    name: m.merchant_name,
    category: m.location ?? 'Farm Goods',
    location: m.location ?? '',
    description: '',
    rating: m.rating ?? 0,
    time: m.delivery_time ? `${m.delivery_time} day${m.delivery_time > 1 ? 's' : ''}` : 'N/A',
    deliveryFee: m.delivery_price ?? 0,
    operatingHours: m.operating_hours ?? '',
    contactInfo: m.contact_number,
    image: PLACEHOLDER_IMAGE,
  };
}

export default function OrderScreen() {
  const router = useRouter();
  const { itemCount } = useCart();
  const { token } = useAuth();
  const [farms, setFarms] = useState<Farm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

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
  }, [token]);

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
    });
  }, [farms, search, activeCategory]);

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good morning</Text>
          <Text style={styles.headerTitle}>Find Fresh Farms</Text>
        </View>
        <TouchableOpacity style={styles.cartBtn} onPress={() => router.push('/(tabs)/cart')}>
          <Ionicons name="cart-outline" size={22} color={Colors.primary} />
          {itemCount > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{itemCount}</Text>
            </View>
          )}
        </TouchableOpacity>
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
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading farms…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={36} color={Colors.warning} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
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

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white,
    marginHorizontal: Spacing.lg, marginTop: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: Spacing.md, ...Shadow.sm,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: FontSize.md, color: Colors.text },

  pills: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, gap: Spacing.sm },
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

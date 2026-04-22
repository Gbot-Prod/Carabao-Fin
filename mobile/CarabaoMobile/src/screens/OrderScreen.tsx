// src/screens/OrderScreen.tsx
import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, TextInput, StyleSheet,
  TouchableOpacity, ScrollView, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import FarmCard from '../components/FarmCard';
import { mockFarms } from '../lib/mockData';
import { useCart } from '../lib/CartContext';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';

const CATEGORIES = ['All', 'Fruits', 'Vegetables', 'Dairy', 'Strawberries', 'Mixed Produce', 'Seafood & Produce'];

export default function OrderScreen() {
  const router = useRouter();
  const { itemCount } = useCart();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  const filtered = useMemo(() => {
    return mockFarms.filter((f) => {
      const matchSearch = f.name.toLowerCase().includes(search.toLowerCase()) ||
        f.category.toLowerCase().includes(search.toLowerCase());
      const matchCat = activeCategory === 'All' || f.category === activeCategory;
      return matchSearch && matchCat;
    });
  }, [search, activeCategory]);

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good morning 🌱</Text>
          <Text style={styles.headerTitle}>Find Fresh Farms</Text>
        </View>
        <TouchableOpacity
          style={styles.cartBtn}
          onPress={() => router.push('/(tabs)/cart')}
        >
          <Text style={styles.cartIcon}>🛒</Text>
          {itemCount > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{itemCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search farms, products..."
          placeholderTextColor={Colors.textLight}
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Category Pills */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pills}
      >
        {CATEGORIES.map((cat) => (
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

      {/* Results count */}
      <View style={styles.resultRow}>
        <Text style={styles.resultText}>{filtered.length} farms available</Text>
      </View>

      {/* Farm Grid */}
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
            <Text style={styles.emptyIcon}>🌾</Text>
            <Text style={styles.emptyText}>No farms found</Text>
            <Text style={styles.emptySubText}>Try adjusting your search</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  greeting: { fontSize: FontSize.sm, color: Colors.textMuted },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  cartBtn: {
    width: 44, height: 44,
    backgroundColor: Colors.primaryLight,
    borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  cartIcon: { fontSize: 20 },
  cartBadge: {
    position: 'absolute', top: -2, right: -2,
    backgroundColor: Colors.error,
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.white,
  },
  cartBadgeText: { color: Colors.white, fontSize: 10, fontWeight: '800' },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    ...Shadow.sm,
  },
  searchIcon: { fontSize: 16, marginRight: Spacing.sm },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: FontSize.md,
    color: Colors.text,
  },

  pills: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  pill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    backgroundColor: Colors.white,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: Spacing.sm,
  },
  pillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  pillText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '500' },
  pillTextActive: { color: Colors.white, fontWeight: '700' },

  resultRow: { paddingHorizontal: Spacing.lg, marginBottom: Spacing.sm },
  resultText: { fontSize: FontSize.sm, color: Colors.textMuted },

  listContent: { paddingHorizontal: Spacing.lg, paddingBottom: 100 },
  row: { justifyContent: 'space-between' },
  cardWrapper: { width: '48.5%', marginBottom: Spacing.md },

  empty: { alignItems: 'center', paddingTop: 60, gap: Spacing.sm },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySubText: { fontSize: FontSize.sm, color: Colors.textMuted },
});

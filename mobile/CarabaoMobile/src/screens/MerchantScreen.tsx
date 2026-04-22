// src/screens/MerchantScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert, FlatList,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { mockFarms, mockProducts } from '../lib/mockData';
import { useCart } from '../lib/CartContext';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { RootStackParamList } from '../types';

type MerchantRoute = RouteProp<RootStackParamList, 'Merchant'>;

export default function MerchantScreen() {
  const router = useRouter();
  const route = useRoute<MerchantRoute>();
  const navigation = useNavigation();
  const { addItem, itemCount } = useCart();
  const { farmId, farmName } = route.params;

  const farm = mockFarms.find((f) => f.id === farmId) ?? mockFarms[0];
  const products = mockProducts[farmId] ?? mockProducts[Object.keys(mockProducts)[0]];

  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const handleAdd = (productId: string, productName: string, price: number) => {
    addItem({
      id: productId,
      farm: farmName,
      produce: productName,
      unit: 'unit',
      price,
    });
    setAddedIds((prev) => new Set([...prev, productId]));
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Custom header */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>{farmName}</Text>
        <View style={styles.cartPill}>
          <Text style={styles.cartPillText}>🛒 {itemCount}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.heroContainer}>
          <Image source={{ uri: farm.image }} style={styles.heroImage} resizeMode="cover" />
          <View style={styles.heroGradient} />
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>{farm.category}</Text>
          </View>
        </View>

        {/* Merchant Info */}
        <View style={styles.infoSection}>
          <Text style={styles.merchantName}>{farm.name}</Text>
          <Text style={styles.merchantLocation}>📍 {farm.location}</Text>
          <Text style={styles.merchantDesc}>{farm.description}</Text>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>⭐ {farm.rating}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>🕒 {farm.time}</Text>
              <Text style={styles.statLabel}>Delivery</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>₱{farm.deliveryFee.toLocaleString()}</Text>
              <Text style={styles.statLabel}>Delivery fee</Text>
            </View>
          </View>

          {/* Details cards */}
          <View style={styles.detailsGrid}>
            <View style={styles.detailCard}>
              <Text style={styles.detailIcon}>🕐</Text>
              <View>
                <Text style={styles.detailLabel}>Hours</Text>
                <Text style={styles.detailValue}>{farm.operatingHours}</Text>
              </View>
            </View>
            <View style={styles.detailCard}>
              <Text style={styles.detailIcon}>📞</Text>
              <View>
                <Text style={styles.detailLabel}>Contact</Text>
                <Text style={styles.detailValue}>{farm.contactInfo}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Products */}
        <View style={styles.productsSection}>
          <Text style={styles.productsTitle}>Available Produce</Text>
          <Text style={styles.productsSubtitle}>{products.length} items available</Text>

          {products.map((product) => {
            const isAdded = addedIds.has(product.id);
            return (
              <View key={product.id} style={styles.productRow}>
                <Image
                  source={{ uri: product.image }}
                  style={styles.productImage}
                  resizeMode="cover"
                />
                <View style={styles.productInfo}>
                  <View style={styles.productCatBadge}>
                    <Text style={styles.productCatText}>{product.category}</Text>
                  </View>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productDesc} numberOfLines={2}>{product.description}</Text>
                  <View style={styles.productFooter}>
                    <Text style={styles.productPrice}>₱{product.price.toLocaleString()}</Text>
                    <TouchableOpacity
                      style={[styles.addBtn, isAdded && styles.addBtnAdded]}
                      onPress={() => handleAdd(product.id, product.name, product.price)}
                    >
                      <Text style={[styles.addBtnText, isAdded && styles.addBtnTextAdded]}>
                        {isAdded ? '✓ Added' : '+ Add'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky Cart CTA */}
      {itemCount > 0 && (
        <View style={styles.cartCta}>
          <Text style={styles.ctaCount}>{itemCount} item{itemCount > 1 ? 's' : ''} in cart</Text>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => router.push('/(tabs)/cart')}
          >
            <Text style={styles.ctaBtnText}>View Cart →</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.white },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { padding: 4 },
  backIcon: { fontSize: 22, color: Colors.text },
  navTitle: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginHorizontal: Spacing.md },
  cartPill: {
    backgroundColor: Colors.primaryLight, paddingHorizontal: 12,
    paddingVertical: 6, borderRadius: Radius.full,
  },
  cartPillText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },

  heroContainer: { height: 240, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroGradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 80,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  heroBadge: {
    position: 'absolute', bottom: Spacing.md, left: Spacing.md,
    backgroundColor: Colors.primary, paddingHorizontal: 12,
    paddingVertical: 5, borderRadius: Radius.full,
  },
  heroBadgeText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '700' },

  infoSection: { padding: Spacing.lg },
  merchantName: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  merchantLocation: { fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing.sm },
  merchantDesc: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20, marginBottom: Spacing.lg },

  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  statLabel: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: Colors.border },

  detailsGrid: { gap: Spacing.sm },
  detailCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
  },
  detailIcon: { fontSize: 20 },
  detailLabel: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600' },
  detailValue: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500' },

  productsSection: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  productsTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  productsSubtitle: { fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing.lg },

  productRow: {
    flexDirection: 'row', gap: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginBottom: Spacing.md,
    ...Shadow.sm,
  },
  productImage: { width: 90, height: 90, borderRadius: Radius.md },
  productInfo: { flex: 1, gap: 4 },
  productCatBadge: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full,
  },
  productCatText: { fontSize: 10, color: Colors.primary, fontWeight: '700' },
  productName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  productDesc: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 16 },
  productFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  productPrice: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  addBtn: {
    backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.primary,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.md,
  },
  addBtnAdded: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  addBtnText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },
  addBtnTextAdded: { color: Colors.white },

  cartCta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    ...Shadow.lg,
  },
  ctaCount: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  ctaBtn: {
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md, borderRadius: Radius.md,
  },
  ctaBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
});

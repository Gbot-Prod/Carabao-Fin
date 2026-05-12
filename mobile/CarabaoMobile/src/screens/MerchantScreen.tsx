// src/screens/MerchantScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, Image, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useCart } from '../lib/CartContext';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiMerchant, type ApiProduce } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';

const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?w=600';

export default function MerchantScreen() {
  const router = useRouter();
  const { farmId, farmName } = useLocalSearchParams<{ farmId: string; farmName: string }>();
  const { addItem, itemCount } = useCart();
  const { token } = useAuth();

  const [merchant, setMerchant] = useState<ApiMerchant | null>(null);
  const [products, setProducts] = useState<ApiProduce[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!farmId) return;
    const id = Number(farmId);
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [m, p] = await Promise.all([
          api.merchants.get(id, token),
          api.merchants.produce(id, token),
        ]);
        setMerchant(m);
        setProducts(p);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load merchant');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [farmId, token]);

  const handleAdd = (product: ApiProduce) => {
    addItem({
      id: String(product.id),
      farm: merchant?.merchant_name ?? farmName ?? '',
      produce: product.name ?? 'Produce',
      unit: product.unit,
      price: product.price,
    });
    setAddedIds((prev) => new Set([...prev, product.id]));
  };

  const displayName = merchant?.merchant_name ?? farmName ?? 'Merchant';

  return (
    <SafeAreaView style={styles.root}>
      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>{displayName}</Text>
        <View style={styles.cartPill}>
          <Text style={styles.cartPillText}>🛒 {itemCount}</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Hero */}
          <View style={styles.heroContainer}>
            <Image source={{ uri: PLACEHOLDER_IMAGE }} style={styles.heroImage} resizeMode="cover" />
            <View style={styles.heroGradient} />
            <View style={styles.heroBadge}>
              <Text style={styles.heroBadgeText}>{merchant?.location ?? 'Farm Goods'}</Text>
            </View>
          </View>

          {/* Merchant Info */}
          <View style={styles.infoSection}>
            <Text style={styles.merchantName}>{displayName}</Text>
            {merchant?.location ? (
              <Text style={styles.merchantLocation}>📍 {merchant.location}</Text>
            ) : null}

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>⭐ {(merchant?.rating ?? 0).toFixed(1)}</Text>
                <Text style={styles.statLabel}>Rating</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>
                  🕒 {merchant?.delivery_time ? `${merchant.delivery_time}d` : 'N/A'}
                </Text>
                <Text style={styles.statLabel}>Delivery</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>₱{(merchant?.delivery_price ?? 0).toLocaleString()}</Text>
                <Text style={styles.statLabel}>Delivery fee</Text>
              </View>
            </View>

            {/* Details */}
            <View style={styles.detailsGrid}>
              {merchant?.operating_hours ? (
                <View style={styles.detailCard}>
                  <Text style={styles.detailIcon}>🕐</Text>
                  <View>
                    <Text style={styles.detailLabel}>Hours</Text>
                    <Text style={styles.detailValue}>{merchant.operating_hours}</Text>
                  </View>
                </View>
              ) : null}
              {merchant?.contact_number ? (
                <View style={styles.detailCard}>
                  <Text style={styles.detailIcon}>📞</Text>
                  <View>
                    <Text style={styles.detailLabel}>Contact</Text>
                    <Text style={styles.detailValue}>{merchant.contact_number}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>

          {/* Products */}
          <View style={styles.productsSection}>
            <Text style={styles.productsTitle}>Available Produce</Text>
            <Text style={styles.productsSubtitle}>{products.length} item{products.length !== 1 ? 's' : ''} available</Text>

            {products.length === 0 ? (
              <View style={styles.noProducts}>
                <Text style={styles.noProductsText}>No products listed yet.</Text>
              </View>
            ) : (
              products.map((product) => {
                const isAdded = addedIds.has(product.id);
                return (
                  <View key={product.id} style={styles.productRow}>
                    {product.image_url ? (
                      <Image source={{ uri: product.image_url }} style={styles.productImage} resizeMode="cover" />
                    ) : (
                      <View style={[styles.productImage, styles.productImagePlaceholder]}>
                        <Text style={{ fontSize: 28 }}>🌿</Text>
                      </View>
                    )}
                    <View style={styles.productInfo}>
                      {product.category ? (
                        <View style={styles.productCatBadge}>
                          <Text style={styles.productCatText}>{product.category}</Text>
                        </View>
                      ) : null}
                      <Text style={styles.productName}>{product.name ?? 'Unnamed'}</Text>
                      {product.description ? (
                        <Text style={styles.productDesc} numberOfLines={2}>{product.description}</Text>
                      ) : null}
                      <View style={styles.productFooter}>
                        <Text style={styles.productPrice}>₱{product.price.toLocaleString()}</Text>
                        <TouchableOpacity
                          style={[styles.addBtn, isAdded && styles.addBtnAdded]}
                          onPress={() => handleAdd(product)}
                        >
                          <Text style={[styles.addBtnText, isAdded && styles.addBtnTextAdded]}>
                            {isAdded ? '✓ Added' : '+ Add'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* Sticky cart CTA */}
      {itemCount > 0 && (
        <View style={styles.cartCta}>
          <Text style={styles.ctaCount}>{itemCount} item{itemCount > 1 ? 's' : ''} in cart</Text>
          <TouchableOpacity style={styles.ctaBtn} onPress={() => router.push('/(tabs)/cart')}>
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
  cartPill: { backgroundColor: Colors.primaryLight, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  cartPillText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
  loadingText: { fontSize: FontSize.sm, color: Colors.textMuted },
  errorIcon: { fontSize: 36 },
  errorText: { fontSize: FontSize.sm, color: Colors.error, textAlign: 'center', paddingHorizontal: Spacing.xl },

  heroContainer: { height: 240, position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, backgroundColor: 'rgba(0,0,0,0.2)' },
  heroBadge: {
    position: 'absolute', bottom: Spacing.md, left: Spacing.md,
    backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full,
  },
  heroBadgeText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '700' },

  infoSection: { padding: Spacing.lg },
  merchantName: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  merchantLocation: { fontSize: FontSize.sm, color: Colors.textMuted, marginBottom: Spacing.md },

  statsRow: {
    flexDirection: 'row', backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.md, paddingVertical: Spacing.md,
    marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
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

  noProducts: { alignItems: 'center', paddingVertical: Spacing.xl },
  noProductsText: { fontSize: FontSize.sm, color: Colors.textMuted },

  productRow: {
    flexDirection: 'row', gap: Spacing.md, backgroundColor: Colors.white,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, marginBottom: Spacing.md, ...Shadow.sm,
  },
  productImage: { width: 90, height: 90, borderRadius: Radius.md },
  productImagePlaceholder: { backgroundColor: Colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  productInfo: { flex: 1, gap: 4 },
  productCatBadge: { alignSelf: 'flex-start', backgroundColor: Colors.primaryLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
  productCatText: { fontSize: 10, color: Colors.primary, fontWeight: '700' },
  productName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  productDesc: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 16 },
  productFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  productPrice: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  addBtn: { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.md },
  addBtnAdded: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  addBtnText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '700' },
  addBtnTextAdded: { color: Colors.white },

  cartCta: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', ...Shadow.lg,
  },
  ctaCount: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  ctaBtn: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.md },
  ctaBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
});

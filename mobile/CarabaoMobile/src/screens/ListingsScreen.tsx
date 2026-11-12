// src/screens/ListingsScreen.tsx
// Merchant's own produce listings. Uses the same endpoints as the web
// merchant dashboard: /users/me to find the merchant, then /merchants/me/produce
// (which, unlike the public list, includes expired and admin-hidden listings).
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView,
  TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiProduce, type ApiStockAlerts, type ProduceCreatePayload } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge, EmptyState } from '../components/UI';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { ListingForm } from '../components/ListingForm';

// F1: why a listing needs attention, from /merchants/me/stock-alerts.
function alertFor(alerts: ApiStockAlerts | null, id: number): string | null {
  if (!alerts) return null;
  if (alerts.expired.some((i) => i.id === id)) return 'Past its best-before date: hidden from buyers.';
  const notes: string[] = [];
  const soon = alerts.expiring_soon.find((i) => i.id === id);
  if (soon) {
    const d = soon.days_left ?? 0;
    notes.push(`Best before ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}`);
  }
  if (alerts.low_stock.some((i) => i.id === id)) notes.push('Low stock');
  return notes.length ? notes.join(' · ') : null;
}

function ListingRow({ item, alert, onPress }: { item: ApiProduce; alert: string | null; onPress: () => void }) {
  const outOfStock = item.stock_quantity <= 0;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.rowInfo}>
        <Text style={styles.rowName}>{item.name ?? 'Untitled listing'}</Text>
        <Text style={styles.rowMeta}>
          ₱{item.price.toLocaleString()} / {item.unit_quantity && item.unit_quantity !== 1 ? `${item.unit_quantity} ` : ''}{item.unit}
          {item.category ? ` · ${item.category}` : ''}
        </Text>
        {alert ? <Text style={styles.rowAlert}>{alert}</Text> : null}
        {item.hidden_at ? (
          <Text style={styles.rowHidden}>
            Hidden by Carabao admin: buyers can't see or order it.
            {item.hidden_reason ? ` Reason: ${item.hidden_reason}` : ''}
          </Text>
        ) : null}
      </View>
      <Badge
        label={outOfStock ? 'Out of stock' : `${item.stock_quantity} in stock`}
        color={outOfStock ? 'gray' : 'green'}
      />
      <Ionicons name="create-outline" size={18} color={Colors.textLight} />
    </TouchableOpacity>
  );
}

function ListingsScreenContent() {
  const router = useRouter();
  const { token } = useAuth();
  const [items, setItems] = useState<ApiProduce[]>([]);
  const [alerts, setAlerts] = useState<ApiStockAlerts | null>(null);
  const [merchantName, setMerchantName] = useState<string | null>(null);
  const [notMerchant, setNotMerchant] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null = closed, 'new' = create form, otherwise the listing being edited.
  const [editing, setEditing] = useState<ApiProduce | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const openEdit = (item: ApiProduce | 'new') => {
    setSaveError(null);
    setEditing(item);
  };

  const handleSave = async (payload: ProduceCreatePayload) => {
    if (!token || !editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing === 'new') {
        const created = await api.produce.create(token, payload);
        setItems((prev) => [...prev, created]);
      } else {
        const updated = await api.produce.update(token, editing.id, payload);
        setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
      setEditing(null);
      api.merchants.stockAlerts(token).then(setAlerts).catch(() => {});
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this listing');
    } finally {
      setSaving(false);
    }
  };

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      const profile = await api.users.me(token);
      if (!profile.merchant) {
        setNotMerchant(true);
        return;
      }
      setMerchantName(profile.merchant.merchant_name);
      const [produce, stockAlerts] = await Promise.all([
        api.merchants.myProduce(token),
        api.merchants.stockAlerts(token).catch(() => null),
      ]);
      setItems(produce);
      setAlerts(stockAlerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your listings');
    }
  }, [token]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  let body: React.ReactNode;
  if (loading) {
    body = <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />;
  } else if (notMerchant) {
    body = (
      <EmptyState
        icon={<Ionicons name="storefront-outline" size={48} color={Colors.textLight} />}
        title="Not a merchant yet"
        message="Register as a merchant to list your produce."
      />
    );
  } else if (error) {
    body = (
      <EmptyState
        icon={<Ionicons name="alert-circle-outline" size={48} color={Colors.error} />}
        title="Something went wrong"
        message={error}
      />
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item }) => (
          <ListingRow item={item} alert={alertFor(alerts, item.id)} onPress={() => openEdit(item)} />
        )}
        ListHeaderComponent={
          alerts && (alerts.low_stock.length || alerts.expiring_soon.length || alerts.expired.length) ? (
            <View style={styles.alertBanner}>
              <Ionicons name="warning-outline" size={18} color={Colors.warning} />
              <Text style={styles.alertBannerText}>
                {[
                  alerts.low_stock.length ? `${alerts.low_stock.length} low on stock (≤ ${alerts.low_stock_threshold})` : null,
                  alerts.expiring_soon.length ? `${alerts.expiring_soon.length} near best-before` : null,
                  alerts.expired.length ? `${alerts.expired.length} expired` : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            icon={<Ionicons name="leaf-outline" size={48} color={Colors.textLight} />}
            title="No listings yet"
            message="Tap “New listing” to add your first produce."
          />
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>{merchantName ? `My listings · ${merchantName}` : 'My listings'}</Text>
        {merchantName ? (
          <TouchableOpacity onPress={() => openEdit('new')} accessibilityLabel="New listing">
            <Ionicons name="add-circle" size={28} color={Colors.primary} />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 28 }} />
        )}
      </View>
      {body}
      <ListingForm
        visible={editing !== null}
        produce={editing === 'new' ? null : editing}
        saving={saving}
        error={saveError}
        onCancel={() => setEditing(null)}
        onSave={handleSave}
      />
    </SafeAreaView>
  );
}

export default function ListingsScreen() {
  return (
    <ProtectedScreen>
      <ListingsScreenContent />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backIcon: { fontSize: 22, color: Colors.text },
  navTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, flexShrink: 1 },
  list: { padding: Spacing.lg, gap: Spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  rowInfo: { flex: 1 },
  rowName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  rowMeta: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 2 },
  rowHidden: { fontSize: FontSize.xs, color: Colors.error, fontWeight: '600', marginTop: 4 },
  rowAlert: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: '700', marginTop: 4 },
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.warning,
  },
  alertBannerText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
});

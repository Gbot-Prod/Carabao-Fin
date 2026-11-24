// src/screens/ProduceScreen.tsx
// Merchant's own produce (the Produce tab). Uses the same endpoints as the web
// merchant dashboard: /users/me to find the merchant, then /merchants/me/produce
// (which, unlike the public list, includes expired and admin-hidden listings).
// S6 (plan §5.7): a photo is picked in the form and uploaded to
// POST /produce/{id}/image right after the listing is saved, and a server message
// for a field shows under that field (rule 8, listingSaveErrors in listingForm.ts).
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView, Alert,
  TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/AuthContext';
import { api, ApiError, type ApiProduce, type ApiStockAlerts, type ProduceCreatePayload } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge, EmptyState } from '../components/UI';
import { SkeletonList, LoadError } from '../components/Skeleton';
import { ListingForm } from '../components/ListingForm';
import { listingSaveErrors, type ListingFieldErrors, type PickedPhoto } from '../lib/listingForm';
import { filePart } from '../lib/uploads';
import { safeImageUri } from '../lib/imageUri';
import { useMerchantData } from '../lib/MerchantDataContext';
import { reviewNote, standingNote, type ListingStanding, type ProduceCheckResult } from '../lib/listingChecks';

// A soft flag's text: a darker amber than Colors.warning, readable on white.
const FLAG_TEXT = '#b45309';

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

function ListingRow({
  item, alert, uploading, onPress,
}: {
  item: ApiProduce;
  alert: string | null;
  /** S6: the photo is uploading; the row shows a placeholder until it is done. */
  uploading: boolean;
  onPress: () => void;
}) {
  const outOfStock = item.stock_quantity <= 0;
  // CF-0130: only a plain https image link is loaded; a local http one in a dev build.
  const photo = safeImageUri(item.image_url, __DEV__);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      {uploading ? (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <ActivityIndicator size="small" color={Colors.primary} />
        </View>
      ) : photo ? (
        <Image
          source={{ uri: photo }} style={styles.thumb} contentFit="cover"
          accessibilityLabel={item.name ? `Photo of ${item.name}` : 'Produce photo'}
        />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Ionicons name="image-outline" size={20} color={Colors.textLight} />
        </View>
      )}
      <View style={styles.rowInfo}>
        <Text style={styles.rowName}>{item.name ?? 'Untitled listing'}</Text>
        <Text style={styles.rowMeta}>
          ₱{item.price.toLocaleString()} / {item.unit_quantity && item.unit_quantity !== 1 ? `${item.unit_quantity} ` : ''}{item.unit}
          {item.category ? ` · ${item.category}` : ''}
        </Text>
        {alert ? <Text style={styles.rowAlert}>{alert}</Text> : null}
        {item.hidden_at ? (
          <Text style={styles.rowHidden}>
            Hidden by Carabao admin: buyers can’t see or order it.
            {item.hidden_reason ? ` Reason: ${item.hidden_reason}` : ''}
          </Text>
        ) : reviewNote(item) ? (
          <Text style={item.status === 'rejected' ? styles.rowHidden : styles.rowReview}>{reviewNote(item)}</Text>
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

// CF-0101: fetch without touching state; the screen applies the result in a .then
// callback (no state set synchronously inside an effect).
type ListingsLoad =
  | { kind: 'ok'; merchantName: string; produce: ApiProduce[]; alerts: ApiStockAlerts | null }
  | { kind: 'notMerchant' }
  | { kind: 'error'; message: string };

async function fetchListings(token: string): Promise<ListingsLoad> {
  try {
    const profile = await api.users.me(token);
    if (!profile.merchant) return { kind: 'notMerchant' };
    const [produce, alerts] = await Promise.all([
      api.merchants.myProduce(token),
      api.merchants.stockAlerts(token).catch(() => null),
    ]);
    return { kind: 'ok', merchantName: profile.merchant.merchant_name, produce, alerts };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : 'Could not load your listings' };
  }
}

export default function ProduceScreen() {
  const { token } = useAuth();
  // The Produce tab's count badge comes from the shared context (S3, productCount), so
  // every change here refreshes it as well as this screen's own list.
  const { refreshProduce } = useMerchantData();
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
  const [saveFieldErrors, setSaveFieldErrors] = useState<ListingFieldErrors>({});
  // S6: the id whose photo is uploading, and why the last upload failed.
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Guardrails Phase 2: penalty points and the new-farm review (optional: no banner on error).
  const [standing, setStanding] = useState<ListingStanding | null>(null);
  const loadStanding = useCallback(() => {
    if (token) api.merchants.listingStanding(token).then(setStanding).catch(() => {});
  }, [token]);
  const canCreate = standing?.can_create_listings ?? true;

  // Guardrails Phase 1: the form's live check (stable, so the form's effect does not rerun).
  const checkListing = useCallback(
    (payload: Parameters<typeof api.produce.check>[1]): Promise<ProduceCheckResult> =>
      api.produce.check(token, payload),
    [token],
  );

  const openEdit = (item: ApiProduce | 'new') => {
    setSaveError(null);
    setSaveFieldErrors({});
    setPhotoError(null);
    setEditing(item);
  };

  // CF-0116: delete after a confirm; the list and stock alerts are updated.
  const confirmDelete = (item: ApiProduce) =>
    Alert.alert('Delete listing?', `"${item.name ?? 'This listing'}" will be removed. Buyers can no longer order it.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!token) return;
          setSaving(true);
          try {
            await api.produce.remove(token, item.id);
            setItems((prev) => prev.filter((p) => p.id !== item.id));
            setEditing(null);
            api.merchants.stockAlerts(token).then(setAlerts).catch(() => {});
            void refreshProduce();
          } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Could not delete this listing');
          } finally {
            setSaving(false);
          }
        },
      },
    ]);

  const handleSave = async (payload: ProduceCreatePayload, photo: PickedPhoto | null) => {
    if (!token || !editing) return;
    setSaving(true);
    setSaveError(null);
    setSaveFieldErrors({});
    setPhotoError(null);
    const creating = editing === 'new';
    try {
      let saved = creating
        ? await api.produce.create(token, payload)
        : await api.produce.update(token, editing.id, payload);
      setItems((prev) => (creating ? [...prev, saved] : prev.map((p) => (p.id === saved.id ? saved : p))));
      // The listing is saved: the stock alerts and the Produce tab's count follow, even
      // when the photo below is refused.
      api.merchants.stockAlerts(token).then(setAlerts).catch(() => {});
      void refreshProduce();
      loadStanding();

      if (photo) {
        // S6: the listing exists before its photo can be sent (backend
        // POST /produce/{id}/image), so the upload follows the save. Until it lands the
        // row shows a placeholder; a refusal shows under the photo, rule 8.
        setUploadingId(saved.id);
        try {
          saved = await api.produce.uploadImage(
            token, saved.id, filePart(photo.uri, photo.name, photo.mimeType),
          );
          setItems((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
        } catch (err) {
          // The listing itself is saved: keep the form open on it so the photo can be
          // tried again, and put the reason under the photo.
          setEditing(saved);
          setPhotoError(err instanceof Error ? err.message : 'The photo could not be uploaded.');
          return;
        } finally {
          setUploadingId(null);
        }
      }

      setEditing(null);
    } catch (err) {
      // Rule 8: a message for a field this form has goes under that field; anything else
      // (network, 5xx, a 400 whose wording names no field) shows at the top.
      const shown = listingSaveErrors(
        err instanceof Error ? err.message : null,
        err instanceof ApiError ? err.fieldErrors : {},
      );
      setSaveFieldErrors(shown.fields);
      setSaveError(shown.top);
    } finally {
      setSaving(false);
    }
  };

  const apply = useCallback((r: ListingsLoad) => {
    if (r.kind === 'notMerchant') {
      setNotMerchant(true);
    } else if (r.kind === 'error') {
      setError(r.message);
    } else {
      setMerchantName(r.merchantName);
      setItems(r.produce);
      setAlerts(r.alerts);
      setError(null);
    }
  }, []);

  const load = useCallback(() => {
    loadStanding();
    return token ? fetchListings(token).then(apply) : Promise.resolve();
  }, [token, apply, loadStanding]);

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
    body = <SkeletonList label="Loading your listings" rows={4} />;
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
      <LoadError
        message={error}
        onRetry={() => {
          setLoading(true);
          void load().finally(() => setLoading(false));
        }}
      />
    );
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(p) => String(p.id)}
        renderItem={({ item }) => (
          <ListingRow
            item={item}
            alert={alertFor(alerts, item.id)}
            uploading={uploadingId === item.id}
            onPress={() => openEdit(item)}
          />
        )}
        ListHeaderComponent={
          <>
            <StandingBanner standing={standing} />
            {alerts && (alerts.low_stock.length || alerts.expiring_soon.length || alerts.expired.length) ? (
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
            ) : null}
          </>
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
        {/* A tab root has no screen behind it, so it has no Back button. */}
        <Text style={styles.navTitle}>{merchantName ? `My listings · ${merchantName}` : 'My listings'}</Text>
        {merchantName ? (
          <TouchableOpacity
            onPress={() =>
              canCreate
                ? openEdit('new')
                : Alert.alert('New listings blocked', standingNote(standing)?.lines.join('\n\n') ?? '')
            }
            accessibilityLabel={canCreate ? 'New listing' : 'New listings blocked: penalty points'}
          >
            <Ionicons name="add-circle" size={28} color={canCreate ? Colors.primary : Colors.textLight} />
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
        uploading={uploadingId !== null}
        error={saveError}
        fieldErrors={saveFieldErrors}
        photoError={photoError}
        onCheck={checkListing}
        onCancel={() => setEditing(null)}
        onSave={handleSave}
        onDelete={editing && editing !== 'new' ? () => confirmDelete(editing) : undefined}
      />
    </SafeAreaView>
  );
}

/** Guardrails Phase 2: penalty points, the new-listing block, the new-farm review. */
function StandingBanner({ standing }: { standing: ListingStanding | null }) {
  const note = standingNote(standing);
  if (!note) return null;
  return (
    <View style={[styles.standing, note.tone === 'blocked' && styles.standingBlocked]} accessibilityRole="summary">
      {note.lines.map((line) => (
        <Text key={line} style={note.tone === 'blocked' ? styles.standingTextBlocked : styles.standingText}>{line}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  navTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, flexShrink: 1 },
  list: { padding: Spacing.lg, gap: Spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  rowInfo: { flex: 1 },
  // S6: the listing's photo (or its placeholder) in the row.
  thumb: { width: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt },
  thumbEmpty: {
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  rowName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  rowMeta: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 2 },
  rowHidden: { fontSize: FontSize.xs, color: Colors.error, fontWeight: '600', marginTop: 4 },
  rowReview: { fontSize: FontSize.xs, color: FLAG_TEXT, fontWeight: '600', marginTop: 4 },
  rowAlert: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: '700', marginTop: 4 },
  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.warningBg, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.warning,
  },
  standing: {
    gap: 4, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: Colors.warning, backgroundColor: Colors.warningBg,
  },
  standingBlocked: { borderColor: Colors.error, backgroundColor: Colors.white },
  standingText: { fontSize: FontSize.sm, color: Colors.text },
  standingTextBlocked: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '600' },
  alertBannerText: { flex: 1, fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
});

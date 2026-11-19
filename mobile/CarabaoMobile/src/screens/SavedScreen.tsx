// src/screens/SavedScreen.tsx
// CF-0104: saved produce (web `saved` page). Hidden, expired and suspended-farm
// listings are left out by the server but stay saved there.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { useSaved } from '../lib/SavedContext';
import { api, type ApiSavedProduce } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { SkeletonList, LoadError } from '../components/Skeleton';
import { SaveHeart } from '../components/SaveHeart';

type Load = { kind: 'ok'; items: ApiSavedProduce[] } | { kind: 'error' };

function fetchSaved(token: string): Promise<Load> {
  return api.saved
    .list(token)
    .then((items): Load => ({ kind: 'ok', items }))
    .catch((): Load => ({ kind: 'error' }));
}

function SavedRow({ item }: { item: ApiSavedProduce }) {
  const router = useRouter();
  const place = [item.merchant_city, item.merchant_province].filter(Boolean).join(', ');
  return (
    <TouchableOpacity
      style={styles.row}
      activeOpacity={0.8}
      onPress={() =>
        router.push({ pathname: '/merchant', params: { farmId: String(item.merchant_id), farmName: item.merchant_name } })
      }
      accessibilityRole="button"
      accessibilityLabel={`${item.name ?? 'Produce'} from ${item.merchant_name}. Open the farm.`}
    >
      {item.image_url ? (
        <Image source={{ uri: item.image_url }} style={styles.image} contentFit="cover" />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]}>
          <Ionicons name="leaf-outline" size={24} color={Colors.textLight} />
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{item.name ?? 'Produce'}</Text>
        <Text style={styles.meta} numberOfLines={1}>{item.merchant_name}{place ? ` · ${place}` : ''}</Text>
        <Text style={styles.price}>₱{item.price.toLocaleString()}/{item.unit}</Text>
      </View>
      <SaveHeart produceId={item.id} name={item.name ?? 'produce'} />
    </TouchableOpacity>
  );
}

function SavedContent() {
  const { token } = useAuth();
  const { isSaved, reload } = useSaved();
  const [items, setItems] = useState<ApiSavedProduce[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshing, setRefreshing] = useState(false);

  const apply = useCallback((r: Load) => {
    if (r.kind === 'ok') {
      setItems(r.items);
      setStatus('ready');
    } else {
      setStatus((s) => (s === 'ready' ? s : 'error'));
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void fetchSaved(token).then((r) => { if (active) apply(r); });
    return () => { active = false; };
  }, [token, apply]);

  const refresh = async () => {
    if (!token) return;
    setRefreshing(true);
    const [r] = await Promise.all([fetchSaved(token), reload()]);
    apply(r);
    setRefreshing(false);
  };

  // A heart tapped off on this screen hides the row at once.
  const shown = items.filter((i) => isSaved(i.id));

  let body: React.ReactNode;
  if (status === 'loading') {
    body = <SkeletonList label="Loading saved produce" rows={4} />;
  } else if (status === 'error') {
    body = (
      <LoadError
        message="We couldn’t load your saved produce. Check your connection and try again."
        onRetry={() => {
          setStatus('loading');
          if (token) void fetchSaved(token).then(apply);
        }}
      />
    );
  } else {
    body = (
      <FlatList
        data={shown}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <SavedRow item={item} />}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="heart-outline" size={48} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>Nothing saved yet</Text>
            <Text style={styles.emptySub}>Tap the heart on any produce to keep it here.</Text>
          </View>
        }
      />
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Saved produce</Text>
      </View>
      {body}
    </SafeAreaView>
  );
}

export default function SavedScreen() {
  return (
    <ProtectedScreen>
      <SavedContent />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md,
    backgroundColor: Colors.white, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    ...Shadow.sm,
  },
  image: { width: 56, height: 56, borderRadius: Radius.md },
  imagePlaceholder: { backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 2 },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  meta: { fontSize: FontSize.xs, color: Colors.textMuted },
  price: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  empty: { alignItems: 'center', paddingTop: 60, gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptySub: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
});

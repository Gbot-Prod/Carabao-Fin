// src/screens/NotificationsScreen.tsx
// The notification centre (U5): same list as the web bell.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiNotification } from '../lib/api';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { EmptyState } from '../components/UI';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { Ionicons } from '@expo/vector-icons';

// Notification links are web paths; open the matching app screen.
function appRoute(link: string | null): Href | null {
  if (!link) return null;
  if (link.startsWith('/track')) return '/(tabs)/track';
  if (link.startsWith('/orders')) return '/(tabs)/history';
  if (link.startsWith('/merchantDashboard')) return '/merchant-orders';
  return null;
}

function NotificationsContent() {
  const router = useRouter();
  const { token } = useAuth();
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api.notifications.list(token)).items);
    } catch {
      // keep what we have
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (n: ApiNotification) => {
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      void api.notifications.markRead(token, n.id).catch(() => {});
    }
    const route = appRoute(n.link);
    if (route) router.push(route);
  };

  const markAll = () => {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })));
    void api.notifications.markAllRead(token).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Notifications</Text>
        <TouchableOpacity onPress={markAll}>
          <Text style={styles.markAll}>Mark all read</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={items}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={[styles.row, !item.read && styles.unread]} onPress={() => open(item)}>
            {!item.read && <View style={styles.dot} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.title}</Text>
              {item.body ? <Text style={styles.body}>{item.body}</Text> : null}
              <Text style={styles.time}>{new Date(item.created_at).toLocaleString('en-PH')}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <EmptyState
            icon={<Ionicons name="notifications-outline" size={48} color={Colors.textLight} />}
            title="No notifications yet"
            message="Order updates, payouts and reviews appear here."
          />
        }
      />
    </SafeAreaView>
  );
}

export default function NotificationsScreen() {
  return (
    <ProtectedScreen>
      <NotificationsContent />
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
  navTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  markAll: { color: Colors.primary, fontWeight: '600', fontSize: FontSize.sm },
  list: { padding: Spacing.lg, gap: Spacing.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start',
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  unread: { borderColor: Colors.primary },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 6 },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  body: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: 2 },
  time: { fontSize: FontSize.xs, color: Colors.textLight, marginTop: 4 },
});

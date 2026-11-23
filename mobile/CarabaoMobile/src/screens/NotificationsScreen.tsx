// src/screens/NotificationsScreen.tsx
// The notification centre (U5): same list as the web bell.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity, RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { appRoute } from '../lib/notificationLinks';
import { openMerchant } from '../lib/openMerchant';
import { applyNoteAction, NOTES_PAGE, notesQuery, unreadAfter, type NoteAction } from '../lib/notificationList';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiNotification } from '../lib/api';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { EmptyState } from '../components/UI';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { Ionicons } from '@expo/vector-icons';

function NotificationsContent() {
  const router = useRouter();
  const { token } = useAuth();
  const [items, setItems] = useState<ApiNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // CF-0121: All / Unread, paging, unread count, row actions.
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  const load = useCallback(() => {
    const mine = ++seq.current;
    return api.notifications
      .page(token, notesQuery(unreadOnly, 0))
      .then((page) => {
        if (mine !== seq.current) return;
        setItems(page.items);
        setUnread(page.unread);
        setTotal(page.total);
      })
      .catch(() => { /* keep what we have */ });
  }, [token, unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = () => {
    if (loadingMore || items.length >= total) return;
    const mine = seq.current;
    setLoadingMore(true);
    api.notifications
      .page(token, notesQuery(unreadOnly, items.length, NOTES_PAGE))
      .then((page) => {
        if (mine !== seq.current) return;
        setItems((prev) => [...prev, ...page.items.filter((x) => !prev.some((p) => p.id === x.id))]);
        setUnread(page.unread);
        setTotal(page.total);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  // The change shows at once; on failure the list is read again from the server.
  const act = (action: NoteAction, call: () => Promise<unknown>) => {
    setUnread((c) => unreadAfter(c, items, action));
    setItems((prev) => applyNoteAction(prev, action, unreadOnly));
    call().catch(() => {
      Alert.alert('Not updated', 'Please try again.');
      void load();
    });
  };

  const open = (n: ApiNotification) => {
    if (!n.read) act({ type: 'read', id: n.id }, () => api.notifications.markRead(token, n.id));
    const route = appRoute(n.link, n.kind);
    if (!route) return;
    // CF-0125: merchant notifications belong to the merchant app now.
    if ('merchant' in route) {
      void openMerchant('dashboard', route.merchant).catch(() =>
        Alert.alert('Could not open Carabao Merchant', 'Please try again.'),
      );
      return;
    }
    router.push(route as Href);
  };

  const rowMenu = (n: ApiNotification) =>
    Alert.alert(n.title, undefined, [
      n.read
        ? { text: 'Mark as unread', onPress: () => act({ type: 'unread', id: n.id }, () => api.notifications.markUnread(token, n.id)) }
        : { text: 'Mark as read', onPress: () => act({ type: 'read', id: n.id }, () => api.notifications.markRead(token, n.id)) },
      { text: 'Delete', style: 'destructive', onPress: () => act({ type: 'delete', id: n.id }, () => api.notifications.remove(token, n.id)) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const markAll = () => act({ type: 'readAll' }, () => api.notifications.markAllRead(token));
  const clearRead = () =>
    Alert.alert('Clear read notifications?', 'Every notification you have read is deleted.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => act({ type: 'deleteRead' }, () => api.notifications.removeRead(token)) },
    ]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Notifications</Text>
        <TouchableOpacity onPress={markAll} disabled={unread === 0} style={styles.headerBtn} accessibilityRole="button">
          <Text style={[styles.markAll, unread === 0 && { opacity: 0.4 }]}>Mark all read</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.tabs}>
        {[false, true].map((u) => (
          <TouchableOpacity
            key={String(u)}
            style={[styles.tab, unreadOnly === u && styles.tabOn]}
            onPress={() => setUnreadOnly(u)}
            accessibilityRole="button"
            accessibilityState={{ selected: unreadOnly === u }}
          >
            <Text style={[styles.tabText, unreadOnly === u && styles.tabTextOn]}>{u ? `Unread (${unread})` : 'All'}</Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        {!unreadOnly && (
          <TouchableOpacity onPress={clearRead} style={styles.headerBtn} accessibilityRole="button">
            <Text style={styles.markAll}>Clear read</Text>
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={items}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={styles.list}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: Spacing.lg }} color={Colors.primary} /> : undefined}
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
          <TouchableOpacity
            style={[styles.row, !item.read && styles.unread]}
            onPress={() => open(item)}
            onLongPress={() => rowMenu(item)}
            accessibilityRole="button"
            accessibilityHint="Long press for mark as read or unread, and delete"
            accessibilityActions={[{ name: 'longpress', label: 'More actions' }]}
            onAccessibilityAction={() => rowMenu(item)}
          >
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
            title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
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
  headerBtn: { minHeight: 44, justifyContent: 'center' },
  tabs: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.xs,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tab: { paddingHorizontal: Spacing.md, minHeight: 36, justifyContent: 'center', borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  tabOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  tabText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  tabTextOn: { color: Colors.white },
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

// Merchant copy of mobile/CarabaoMobile/src/screens/NotificationsScreen.tsx (S12, plan §4.5).
// It lists only the farm's notifications and opens merchant screens through
// src/lib/notificationLinks.ts; the buyer app keeps its own copy.
//
// The notification centre (U5): same list as the web bell.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity, RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { appRoute, isMerchantNotification } from '../lib/notificationLinks';
import { applyNoteAction, NOTES_PAGE, notesQuery, type NoteAction } from '../lib/notificationList';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiNotification } from '../lib/api';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { EmptyState } from '../components/UI';

// The most server rows the list reads by itself to find the farm's rows (10 pages of
// NOTES_PAGE); after that the reader asks for more with the footer button.
const AUTO_FILL_ROWS = NOTES_PAGE * 10;

// The root gate (app/_layout.tsx) already checked the farm.
function NotificationsContent() {
  const router = useRouter();
  const { token } = useAuth();
  // Every row the server sent; `notes` is the farm's share of them.
  const [rows, setRows] = useState<ApiNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // CF-0121: All / Unread, paging, row actions.
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const seq = useRef(0);

  // Plan §4.5: buyer notifications share the account, and the merchant list shows only the
  // farm's. The unread count follows the listed rows.
  const notes = useMemo(() => rows.filter((n) => isMerchantNotification(n.link)), [rows]);
  const unread = useMemo(() => notes.filter((n) => !n.read).length, [notes]);

  // A server page can hold only buyer rows, which the filter hides, and a short list may
  // never reach `onEndReached`. So after each read, read the next pages by itself while the
  // farm's rows are short of a page. It stops at the server total or AUTO_FILL_ROWS; past
  // that, the footer button reads on. `have` is every server row shown so far.
  const fill = useCallback(async (have: ApiNotification[], serverTotal: number, mine: number) => {
    let list = have;
    let max = serverTotal;
    const short = () => list.filter((n) => isMerchantNotification(n.link)).length < NOTES_PAGE;
    if (!(list.length < max && list.length < AUTO_FILL_ROWS && short())) return;
    setLoadingMore(true);
    try {
      while (mine === seq.current && list.length < max && list.length < AUTO_FILL_ROWS && short()) {
        const page = await api.notifications.page(token, notesQuery(unreadOnly, list.length, NOTES_PAGE));
        if (mine !== seq.current || page.items.length === 0) return;
        const fresh = page.items.filter((x) => !list.some((p) => p.id === x.id));
        list = [...list, ...fresh];
        max = page.total;
        setRows((prev) => [...prev, ...fresh.filter((x) => !prev.some((p) => p.id === x.id))]);
        setTotal(page.total);
      }
    } catch {
      // Keep what we have; the footer button or a pull to refresh reads again.
    } finally {
      if (mine === seq.current) setLoadingMore(false);
    }
  }, [token, unreadOnly]);

  const load = useCallback(() => {
    const mine = ++seq.current;
    return api.notifications
      .page(token, notesQuery(unreadOnly, 0))
      .then((page) => {
        if (mine !== seq.current) return;
        setRows(page.items);
        setTotal(page.total);
        return fill(page.items, page.total, mine);
      })
      .catch(() => { /* keep what we have */ });
  }, [token, unreadOnly, fill]);

  useEffect(() => {
    void load();
  }, [load]);

  // The next page starts after every row the server sent, not after the farm's rows only,
  // or rows the filter hid would come back on the next page. The server total counts those
  // rows too, so it is the right stopping point.
  const loadMore = () => {
    if (loadingMore || rows.length >= total) return;
    const mine = seq.current;
    setLoadingMore(true);
    api.notifications
      .page(token, notesQuery(unreadOnly, rows.length, NOTES_PAGE))
      .then((page) => {
        if (mine !== seq.current) return;
        const fresh = page.items.filter((x) => !rows.some((p) => p.id === x.id));
        setRows((prev) => [...prev, ...fresh.filter((x) => !prev.some((p) => p.id === x.id))]);
        setTotal(page.total);
        setLoadingMore(false);
        // Below AUTO_FILL_ROWS this reads on as after the first page; past it, each press of
        // the footer button reads one page.
        return fill([...rows, ...fresh], page.total, mine);
      })
      .catch(() => {})
      .finally(() => { if (mine === seq.current) setLoadingMore(false); });
  };

  const more = rows.length < total;
  const short = notes.length < NOTES_PAGE;

  // The change shows at once; on failure the list is read again from the server.
  const act = (action: NoteAction, call: () => Promise<unknown>) => {
    setRows((prev) => applyNoteAction(prev, action, unreadOnly));
    call().catch(() => {
      Alert.alert('Not updated', 'Please try again.');
      void load();
    });
  };

  const open = (n: ApiNotification) => {
    if (!n.read) act({ type: 'read', id: n.id }, () => api.notifications.markRead(token, n.id));
    const route = appRoute(n.link, n.kind);
    // Buyer notifications never reach this list; a missing or unknown link opens nothing.
    if (!route) return;
    router.push(route as Href);
  };

  // Row actions only: "Mark all read" and "Clear read" call the account-wide endpoints and
  // would change buyer notifications this screen does not show, so the merchant app leaves
  // them to the buyer app.
  const rowMenu = (n: ApiNotification) =>
    Alert.alert(n.title, undefined, [
      n.read
        ? { text: 'Mark as unread', onPress: () => act({ type: 'unread', id: n.id }, () => api.notifications.markUnread(token, n.id)) }
        : { text: 'Mark as read', onPress: () => act({ type: 'read', id: n.id }, () => api.notifications.markRead(token, n.id)) },
      { text: 'Delete', style: 'destructive', onPress: () => act({ type: 'delete', id: n.id }, () => api.notifications.remove(token, n.id)) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Notifications</Text>
        <View style={{ width: 22 }} />
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
      </View>
      <FlatList
        data={notes}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={styles.list}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator style={{ margin: Spacing.lg }} color={Colors.primary} />
          ) : more && short ? (
            <TouchableOpacity style={styles.older} onPress={loadMore} accessibilityRole="button">
              <Text style={styles.olderText}>Show older notifications</Text>
            </TouchableOpacity>
          ) : undefined
        }
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
          // While the server has more rows, the farm's rows may still come: no empty state yet.
          more ? undefined : (
            <EmptyState
              icon={<Ionicons name="notifications-outline" size={48} color={Colors.textLight} />}
              title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}
              message="Orders, payouts and reviews appear here."
            />
          )
        }
      />
    </SafeAreaView>
  );
}

// The root gate already keeps every merchant screen behind `allowed` (plan §4.3).
export default function NotificationsScreen() {
  return <NotificationsContent />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  older: { minHeight: 44, alignItems: 'center', justifyContent: 'center', margin: Spacing.md },
  olderText: { color: Colors.primary, fontWeight: '700', fontSize: FontSize.sm },
  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backIcon: { fontSize: 22, color: Colors.text },
  navTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
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

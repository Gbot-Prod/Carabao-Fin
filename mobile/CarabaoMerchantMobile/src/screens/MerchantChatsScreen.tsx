// src/screens/MerchantChatsScreen.tsx
// CF-0127: the farm's order chats (web merchant shell "chats"): unread first,
// refreshed every 30 s while in view; a row opens the existing order chat.
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';
import { inboxChatTitle, preview, sinceLabel, sortInbox, type ChatSummary } from '../lib/chatInbox';
import { orderStatusLabel } from '../lib/orderStatus';
import { usePolling } from '../lib/usePolling';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { SkeletonList, LoadError } from '../components/Skeleton';

// The Chats tab. The root gate (app/_layout.tsx) already checked the farm, so this
// screen does not repeat that check.
export default function MerchantChatsScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [rows, setRows] = useState<ChatSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api.merchants
        .chats(token)
        .then((list) => { setRows(sortInbox(list)); setFailed(false); })
        .catch(() => setFailed(true))
        .finally(() => setRefreshing(false)),
    [token],
  );
  // Also on every return from a chat (opening a thread marks it read).
  usePolling(load, 30_000, !!token);

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={24} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Chats</Text>
    </View>
  );

  if (failed && rows === null) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <LoadError message="We couldn’t load your chats." onRetry={() => { setFailed(false); void load(); }} />
      </SafeAreaView>
    );
  }
  if (rows === null) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <SkeletonList label="Loading chats" rows={4} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.order_id)}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={44} color={Colors.textLight} />
            <Text style={styles.emptyTitle}>No chats yet</Text>
            <Text style={styles.muted}>Buyers can message you about their orders. Their messages show here.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.row, item.unread > 0 && styles.rowUnread]}
            onPress={() => router.push({ pathname: '/order-chat', params: { orderId: String(item.order_id), title: inboxChatTitle(item) } })}
            accessibilityRole="button"
            accessibilityLabel={`${item.buyer_name ?? 'Buyer'}, order ${item.order_ref}${item.unread ? `, ${item.unread} unread` : ''}`}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <View style={styles.top}>
                <Text style={[styles.name, item.unread > 0 && styles.bold]} numberOfLines={1}>
                  {item.buyer_name ?? 'Buyer'}
                </Text>
                <Text style={styles.muted}>{sinceLabel(item.last_at)}</Text>
              </View>
              <Text style={styles.muted} numberOfLines={1}>
                {item.order_ref} · {orderStatusLabel(item.order_status)}{item.closed ? ' · closed' : ''}
              </Text>
              <Text style={[styles.preview, item.unread > 0 && styles.bold]} numberOfLines={1}>{preview(item)}</Text>
            </View>
            {item.unread > 0 && <Text style={styles.badge}>{item.unread}</Text>}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, minHeight: 64,
    backgroundColor: Colors.white, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
  },
  rowUnread: { borderColor: Colors.primary },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  preview: { fontSize: FontSize.sm, color: Colors.text },
  bold: { fontWeight: '800' },
  muted: { fontSize: FontSize.xs, color: Colors.textMuted },
  badge: {
    minWidth: 24, textAlign: 'center', fontSize: FontSize.xs, fontWeight: '800', color: Colors.white,
    backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 6, overflow: 'hidden',
  },
  empty: { alignItems: 'center', paddingTop: 40, gap: Spacing.sm },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
});

// src/screens/MerchantChatsScreen.tsx
// CF-0127 + S5: the farm's chats (web merchant shell "chats"). Two segments: "Orders" is
// the order chats, "Questions" the buyers' pre-order inquiries (same row rules, unread
// first). MerchantDataContext loads and polls both, so the tab badge and this list agree;
// a row opens the existing order chat (orderId or inquiry).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMerchantData } from '../lib/MerchantDataContext';
import { unreadChatCount } from '../lib/badges';
import {
  INQUIRY_TAG, inboxChatTitle, inquiryChatTitle, preview, sinceLabel, sortInbox,
  type ChatSummary, type InquirySummary,
} from '../lib/chatInbox';
import { parseOrderId } from '../lib/orderChat';
import { orderStatusLabel } from '../lib/orderStatus';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { SkeletonList, LoadError } from '../components/Skeleton';

/** One row: a chat about an order, or a question a buyer asked before buying (S5). */
type Row =
  | { kind: 'order'; key: string; chat: ChatSummary }
  | { kind: 'inquiry'; key: string; chat: InquirySummary };

type Segment = 'orders' | 'questions';

// The Chats tab. The root gate (app/_layout.tsx) already checked the farm, so this
// screen does not repeat that check.
export default function MerchantChatsScreen() {
  const router = useRouter();
  // The provider loads chats and questions for the tab badge and polls them; this screen
  // only draws them, so a thread read in the chat screen shows as read here at once (S5).
  const { chats, inquiries, chatsError, refreshChats } = useMerchantData();
  const [segment, setSegment] = useState<Segment>('orders');
  const [refreshing, setRefreshing] = useState(false);

  // Plan §4.5: `carabaomerchant://chats?order=12` (and the buyer app's hand-off) opens that
  // order's chat on top of this list; `?inquiry=3` opens a question (S5). CF-0114: the id is
  // checked before it is used, and the param is cleared first so a return to this tab does
  // not open the chat again.
  const { order, inquiry } = useLocalSearchParams<{ order?: string; inquiry?: string }>();
  useEffect(() => {
    const orderId = parseOrderId(order);
    const conversationId = parseOrderId(inquiry);
    if (orderId === null && conversationId === null) return;
    router.setParams({ order: undefined, inquiry: undefined });
    if (orderId !== null) {
      router.push({ pathname: '/order-chat', params: { orderId: String(orderId) } });
    } else if (conversationId !== null) {
      router.push({ pathname: '/order-chat', params: { inquiry: String(conversationId) } });
    }
  }, [order, inquiry, router]);

  const rows = useMemo<Row[]>(
    () =>
      segment === 'questions'
        ? sortInbox(inquiries ?? []).map((chat) => ({
          kind: 'inquiry' as const, key: `inquiry-${chat.conversation_id}`, chat,
        }))
        : sortInbox(chats ?? []).map((chat) => ({
          kind: 'order' as const, key: `order-${chat.order_id}`, chat,
        })),
    [segment, chats, inquiries],
  );

  // The Chats badge's count: rows with an unread message, both segments (badges.ts).
  const orderUnread = unreadChatCount(chats ?? []);
  const questionUnread = unreadChatCount([], inquiries ?? []);
  const unread = orderUnread + questionUnread;

  const reload = useCallback(() => {
    setRefreshing(true);
    void refreshChats().finally(() => setRefreshing(false));
  }, [refreshChats]);

  const header = (
    <View style={styles.header}>
      {/* A tab root has no screen behind it, so it has no Back button. */}
      <Text style={styles.headerTitle}>Chats</Text>
      <Text style={styles.headerSub}>
        {unread > 0
          ? `${unread} chat${unread === 1 ? '' : 's'} with new messages.`
          : 'Questions from buyers before they order, and messages about their orders.'}
      </Text>
      <View style={styles.segments}>
        <SegmentButton
          label="Orders"
          count={orderUnread}
          active={segment === 'orders'}
          onPress={() => setSegment('orders')}
        />
        <SegmentButton
          label="Questions"
          count={questionUnread}
          active={segment === 'questions'}
          onPress={() => setSegment('questions')}
        />
      </View>
    </View>
  );

  const current = segment === 'questions' ? inquiries : chats;
  if (current === null && chatsError) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <LoadError message="We couldn’t load your chats." onRetry={reload} />
      </SafeAreaView>
    );
  }
  if (current === null) {
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
        keyExtractor={(r) => r.key}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
        ListEmptyComponent={<EmptyChats segment={segment} />}
        renderItem={({ item }) => (
          <ChatRow
            item={item}
            onOpen={() => router.push(
              item.kind === 'order'
                ? {
                  pathname: '/order-chat',
                  params: { orderId: String(item.chat.order_id), title: inboxChatTitle(item.chat) },
                }
                : {
                  pathname: '/order-chat',
                  params: { inquiry: String(item.chat.conversation_id), title: inquiryChatTitle(item.chat) },
                },
            )}
          />
        )}
      />
    </SafeAreaView>
  );
}

/** One row of either segment (the web's ChatRow). */
function ChatRow({ item, onOpen }: { item: Row; onOpen: () => void }) {
  const unread = item.chat.unread > 0;
  const meta = item.kind === 'order'
    ? `${item.chat.order_ref} · ${orderStatusLabel(item.chat.order_status)}`
    : INQUIRY_TAG;
  const buyer = item.chat.buyer_name ?? 'Buyer';
  return (
    <TouchableOpacity
      style={[styles.row, unread && styles.rowUnread]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={
        `${buyer}, ${meta}${item.chat.closed ? ', closed' : ''}${unread ? `, ${item.chat.unread} unread` : ''}`
      }
    >
      <View style={styles.rowText}>
        <View style={styles.top}>
          <Text style={[styles.name, unread && styles.bold]} numberOfLines={1}>{buyer}</Text>
          <Text style={styles.muted}>{sinceLabel(item.chat.last_at)}</Text>
        </View>
        <Text style={styles.muted} numberOfLines={1}>
          {meta}{item.chat.closed ? ' · closed' : ''}
        </Text>
        <Text style={[styles.preview, unread && styles.bold]} numberOfLines={1}>{preview(item.chat)}</Text>
      </View>
      {unread && <Text style={styles.badge}>{item.chat.unread}</Text>}
    </TouchableOpacity>
  );
}

/** "Orders" / "Questions" with the number of rows that have an unread message. */
function SegmentButton({ label, count, active, onPress }: {
  label: string;
  count: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.segment, active && styles.segmentActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
      {count > 0 && (
        <Text style={[styles.segmentCount, active && styles.segmentCountActive]}>{count}</Text>
      )}
    </TouchableOpacity>
  );
}

function EmptyChats({ segment }: { segment: Segment }) {
  return segment === 'questions' ? (
    <View style={styles.empty}>
      <Ionicons name="help-circle-outline" size={44} color={Colors.textLight} />
      <Text style={styles.emptyTitle}>No questions yet</Text>
      <Text style={styles.emptyText}>
        Buyers can ask you about your farm or produce before they order. Their questions show here.
      </Text>
    </View>
  ) : (
    <View style={styles.empty}>
      <Ionicons name="chatbubbles-outline" size={44} color={Colors.textLight} />
      <Text style={styles.emptyTitle}>No chats yet</Text>
      <Text style={styles.emptyText}>Buyers can message you about their orders. Their messages show here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    gap: Spacing.xs, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  headerSub: { fontSize: FontSize.xs, color: Colors.textMuted },
  segments: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  segment: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: 6,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
    minHeight: 32,
  },
  segmentActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  segmentText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  segmentTextActive: { color: Colors.primaryDark, fontWeight: '800' },
  segmentCount: { fontSize: FontSize.xs, fontWeight: '800', color: Colors.textMuted },
  segmentCountActive: { color: Colors.primaryDark },
  list: { padding: Spacing.lg, gap: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, minHeight: 64,
    backgroundColor: Colors.white, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
  },
  rowUnread: { borderColor: Colors.primary },
  rowText: { flex: 1, gap: 2 },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  preview: { fontSize: FontSize.sm, color: Colors.text },
  bold: { fontWeight: '800' },
  muted: { fontSize: FontSize.xs, color: Colors.textMuted },
  badge: {
    minWidth: 24, textAlign: 'center', fontSize: FontSize.xs, fontWeight: '800', color: Colors.white,
    backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 6, overflow: 'hidden',
  },
  empty: { alignItems: 'center', paddingTop: 40, gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  emptyText: { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' },
});

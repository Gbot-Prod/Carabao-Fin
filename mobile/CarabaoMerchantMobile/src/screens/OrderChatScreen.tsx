// Merchant copy of mobile/CarabaoMobile/src/screens/OrderChatScreen.tsx - keep behaviour the same.
// src/screens/OrderChatScreen.tsx
// Order chat on mobile (CH1c): the same thread as the web and the buyer app. The Orders
// and Chats tabs open it; it polls every 10 seconds while this screen is open. With
// `support=1` it shows the account's support chat with the admins instead (CH2); with
// `inquiry=<conversation_id>` it shows the farm's side of a buyer's pre-order question (S5).
// The root gate (app/_layout.tsx) already checked the farm.
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiChatMessage } from '../lib/api';
import { chatTarget, chatTitle } from '../lib/orderChat';
import { useMerchantData } from '../lib/MerchantDataContext';
import { usePolling } from '../lib/usePolling';
import { shouldPollChat } from '../lib/livePolling';
import { CHAT_BODY_MAX } from '../lib/inputLimits';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { isPhoneVerificationRequired, PhoneVerifySheet } from '../components/PhoneVerifySheet';

const POLL_MS = 10_000;
const ROLE_LABEL: Record<string, string> = { buyer: 'Buyer', merchant: 'Farm', admin: 'Carabao support', user: 'You' };

export default function OrderChatScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const { orderId, inquiry, title, support } = useLocalSearchParams<{
    orderId?: string;
    inquiry?: string;
    title?: string;
    support?: string;
  }>();
  // CF-0114: route values can come from a deep link: chatTarget checks the ids before use.
  // S5: one target names the thread and its endpoint (orderChat.chatEndpoint), so the order,
  // support and inquiry branches cannot drift.
  const target = useMemo(() => chatTarget(orderId, inquiry, support === '1'), [orderId, inquiry, support]);
  const headerTitle = chatTitle(title, target);
  // Reading a thread marks it read on the server; this drops the Chats badge with it (S5).
  const { refreshChats } = useMerchantData();
  const [messages, setMessages] = useState<ApiChatMessage[]>([]);
  const [closed, setClosed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [needsPhone, setNeedsPhone] = useState(false);
  // After verifying, the unsent message is still in the box; say so.
  const [verified, setVerified] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);
  const listRef = useRef<FlatList<ApiChatMessage>>(null);

  const poll = useCallback(async () => {
    if (!token || !target) return;
    try {
      const thread =
        target.kind === 'support'
          ? await api.support.thread(token, lastId.current)
          : target.kind === 'inquiry'
            ? await api.inquiry.thread(token, target.conversationId, lastId.current)
            : await api.chat.thread(token, target.orderId, lastId.current);
      if (thread.messages.length) {
        lastId.current = thread.messages[thread.messages.length - 1].id;
        setMessages((prev) => [...prev, ...thread.messages.filter((m) => !prev.some((p) => p.id === m.id))]);
        // The server has just marked these read for the farm: refresh the inbox so the
        // Chats badge and row drop them now (web markRead / markInquiryRead).
        void refreshChats();
      }
      setClosed(thread.closed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load messages');
    } finally {
      setLoaded(true);
    }
  }, [token, target, refreshChats]);

  // CF-0117: only while this chat is in view and the app is in the foreground.
  // CF-0134: and not after the server says the thread is closed.
  usePolling(poll, POLL_MS, shouldPollChat(target !== null, closed));

  const send = async () => {
    const body = draft.trim();
    if (!body || !token || !target) return;
    setSending(true);
    setVerified(false);
    try {
      const message =
        target.kind === 'support'
          ? await api.support.send(token, body)
          : target.kind === 'inquiry'
            ? await api.inquiry.send(token, target.conversationId, body)
            : await api.chat.send(token, target.orderId, body);
      lastId.current = Math.max(lastId.current, message.id);
      setMessages((prev) => [...prev, message]);
      setDraft('');
      setError(null);
      // The answer moves the inbox row's preview too (S5).
      void refreshChats();
    } catch (err) {
      // A merchant needs a verified mobile number to answer the buyer.
      if (isPhoneVerificationRequired(err)) setNeedsPhone(true);
      else setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  // An inquiry has no delivery to close it: the farm's shop does that (web `closedText`).
  const emptyText = target?.kind === 'inquiry'
    ? 'No messages yet. Answer the buyer’s question.'
    : 'No messages yet. Reply to the buyer or ask about the delivery.';
  const closedText = target?.kind === 'inquiry'
    ? 'Your shop is not taking messages right now, so this chat is read-only.'
    : 'This chat closed 7 days after delivery.';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>{headerTitle}</Text>
        <View style={{ width: 22 }} />
      </View>
      {target === null ? (
        <Text style={{ margin: 40, textAlign: 'center', color: Colors.textMuted }}>
          Chat not found. The link may be wrong.
        </Text>
      ) : (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!loaded ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => (
              <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
                <Text style={styles.meta}>
                  {item.mine ? 'You' : ROLE_LABEL[item.sender_role] ?? item.sender_role} ·{' '}
                  {new Date(item.created_at).toLocaleString('en-PH')}
                </Text>
                <Text style={styles.body}>{item.body}</Text>
              </View>
            )}
            ListEmptyComponent={
              <Text style={styles.note}>{emptyText}</Text>
            }
          />
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {verified && !error ? <Text style={styles.notice}>Number verified. Press Send to send your message.</Text> : null}
        {closed ? (
          <Text style={styles.closed}>{closedText}</Text>
        ) : (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message"
              placeholderTextColor={Colors.textLight}
              multiline
              maxLength={CHAT_BODY_MAX}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!draft.trim() || sending) && styles.disabled]}
              onPress={send}
              disabled={!draft.trim() || sending}
            >
              <Text style={styles.sendText}>{sending ? '…' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
      )}
      <PhoneVerifySheet
        visible={needsPhone}
        reason="Verify your mobile number to message the buyer."
        onClose={() => setNeedsPhone(false)}
        onVerified={() => {
          setNeedsPhone(false);
          setVerified(true);
        }}
      />
    </SafeAreaView>
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
  navTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  list: { padding: Spacing.lg, gap: Spacing.sm, flexGrow: 1 },
  bubble: { maxWidth: '85%', padding: Spacing.md, borderRadius: Radius.md },
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.successBg },
  theirs: { alignSelf: 'flex-start', backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  meta: { fontSize: FontSize.xs, color: Colors.textMuted, marginBottom: 2 },
  body: { fontSize: FontSize.md, color: Colors.text },
  note: { textAlign: 'center', color: Colors.textMuted, marginTop: Spacing.xl },
  error: { color: Colors.error, fontSize: FontSize.sm, paddingHorizontal: Spacing.lg },
  notice: { color: Colors.textMuted, fontSize: FontSize.sm, paddingHorizontal: Spacing.lg },
  closed: { textAlign: 'center', color: Colors.textMuted, padding: Spacing.lg },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm,
    padding: Spacing.md, backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  input: {
    flex: 1, maxHeight: 120, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: FontSize.md, color: Colors.text,
  },
  sendBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  disabled: { opacity: 0.5 },
  sendText: { color: Colors.white, fontWeight: '700' },
});


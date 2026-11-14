// src/screens/OrderChatScreen.tsx
// Order chat on mobile (CH1c): same thread as the web. Polls every 10 seconds
// while this screen is open. With `support=1` it shows the user's support
// chat with the admins instead (CH2).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, type ApiChatMessage } from '../lib/api';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { isPhoneVerificationRequired, PhoneVerifySheet } from '../components/PhoneVerifySheet';

const POLL_MS = 10_000;
const ROLE_LABEL: Record<string, string> = { buyer: 'Buyer', merchant: 'Farm', admin: 'Carabao support', user: 'You' };

function OrderChatContent() {
  const router = useRouter();
  const { token } = useAuth();
  const { orderId, title, support } = useLocalSearchParams<{
    orderId?: string;
    title?: string;
    support?: string;
  }>();
  const isSupport = support === '1';
  const id = Number(orderId);
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
    if (!token || (!isSupport && !Number.isFinite(id))) return;
    try {
      const thread = isSupport
        ? await api.support.thread(token, lastId.current)
        : await api.chat.thread(token, id, lastId.current);
      if (thread.messages.length) {
        lastId.current = thread.messages[thread.messages.length - 1].id;
        setMessages((prev) => [...prev, ...thread.messages.filter((m) => !prev.some((p) => p.id === m.id))]);
      }
      setClosed(thread.closed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load messages');
    } finally {
      setLoaded(true);
    }
  }, [token, id, isSupport]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !token) return;
    setSending(true);
    setVerified(false);
    try {
      const message = isSupport
        ? await api.support.send(token, body)
        : await api.chat.send(token, id, body);
      lastId.current = Math.max(lastId.current, message.id);
      setMessages((prev) => [...prev, message]);
      setDraft('');
      setError(null);
    } catch (err) {
      // Buyers need a verified mobile number to message the farm.
      if (isPhoneVerificationRequired(err)) setNeedsPhone(true);
      else setError(err instanceof Error ? err.message : 'Could not send');
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()} accessibilityLabel="Back">
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>{title ?? (isSupport ? 'Carabao support' : `Order #${orderId}`)}</Text>
        <View style={{ width: 22 }} />
      </View>
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
              <Text style={styles.note}>No messages yet. Ask about the produce or the delivery.</Text>
            }
          />
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {verified && !error ? <Text style={styles.notice}>Number verified. Press Send to send your message.</Text> : null}
        {closed ? (
          <Text style={styles.closed}>This chat closed 7 days after delivery.</Text>
        ) : (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a message"
              placeholderTextColor={Colors.textLight}
              multiline
              maxLength={2000}
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
      <PhoneVerifySheet
        visible={needsPhone}
        reason="Verify your mobile number to message the farm."
        onClose={() => setNeedsPhone(false)}
        onVerified={() => {
          setNeedsPhone(false);
          setVerified(true);
        }}
      />
    </SafeAreaView>
  );
}

export default function OrderChatScreen() {
  return (
    <ProtectedScreen>
      <OrderChatContent />
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

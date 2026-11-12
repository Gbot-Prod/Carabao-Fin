// src/screens/ConfirmationScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView,
  TouchableOpacity, Animated, ScrollView, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { useAuth } from '../lib/AuthContext';
import { api, ApiError, type TransactionStatus } from '../lib/api';

type PaymentView = 'paid' | 'pending' | 'expired';

// failed/expired both mean the checkout closed without payment; refunds only
// happen after a successful payment.
function toPaymentView(status: TransactionStatus | null): PaymentView {
  if (status === 'paid' || status === 'refund_pending' || status === 'refunded') return 'paid';
  if (status === 'failed' || status === 'expired') return 'expired';
  return 'pending';
}

const PAYMENT_COPY: Record<PaymentView, { title: string; sub: string; badge: string }> = {
  paid: {
    title: 'Payment Received!',
    sub: 'Your order has been paid and sent to the farm for preparation.',
    badge: 'Paid',
  },
  pending: {
    title: 'Order Placed',
    sub: 'We are waiting for PayMongo to confirm your payment. This page updates automatically.',
    badge: 'Pending Payment',
  },
  expired: {
    title: 'Payment Expired',
    sub: 'The payment window closed before payment was received, so the reserved stock was released. Please place the order again.',
    badge: 'Expired',
  },
};

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 30; // ~2 minutes; the buyer can tap "Check again" after that.

const STEPS = [
  { icon: '✅', label: 'Merchant confirms stock' },
  { icon: '📦', label: 'Produce is prepared and packed' },
  { icon: '🚚', label: 'Rider pickup and delivery' },
];

function ConfirmationScreenContent() {
  const router = useRouter();
  const { orderId, orderRef } = useLocalSearchParams<{ orderId?: string; orderRef?: string }>();
  const { token } = useAuth();
  const numericOrderId = Number(orderId);
  const [txnStatus, setTxnStatus] = useState<TransactionStatus | null>(null);
  const [polls, setPolls] = useState(0);
  const [paying, setPaying] = useState(false);
  const view = toPaymentView(txnStatus);
  const copy = PAYMENT_COPY[view];

  const checkStatus = useCallback(async () => {
    if (!token || !Number.isFinite(numericOrderId)) return;
    try {
      const txn = await api.payments.transactionByOrder(token, numericOrderId);
      setTxnStatus(txn.status);
    } catch (err) {
      // 404 = checkout session not created yet; keep showing pending.
      if (!(err instanceof ApiError && err.status === 404)) {
        console.warn('Payment status check failed', err);
      }
    }
  }, [token, numericOrderId]);

  useEffect(() => {
    if (view !== 'pending' || polls >= MAX_POLLS) return;
    const timer = setTimeout(
      () => {
        void checkStatus().finally(() => setPolls((p) => p + 1));
      },
      polls === 0 ? 0 : POLL_INTERVAL_MS,
    );
    return () => clearTimeout(timer);
  }, [view, polls, checkStatus]);

  const handlePayNow = async () => {
    if (!token || !Number.isFinite(numericOrderId)) return;
    setPaying(true);
    try {
      const checkout = await api.payments.checkout(token, numericOrderId);
      await WebBrowser.openBrowserAsync(checkout.checkout_url);
      setPolls(0); // restart polling after the browser closes
    } catch (err) {
      Alert.alert('Payment not started', err instanceof Error ? err.message : 'Please try again.');
      await checkStatus();
    } finally {
      setPaying(false);
    }
  };

  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const slideY = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 80, friction: 6 }),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideY, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]),
    ]).start();
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Check animation */}
        <View style={styles.heroArea}>
          <Animated.View style={[styles.checkCircle, { transform: [{ scale }] }]}>
            <Text style={styles.checkEmoji}>{view === 'paid' ? '✓' : view === 'pending' ? '…' : '!'}</Text>
          </Animated.View>
          <Animated.View style={{ opacity, transform: [{ translateY: slideY }] }}>
            <Text style={styles.heroTitle}>{copy.title}</Text>
            <Text style={styles.heroSub}>{copy.sub}</Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.content, { opacity, transform: [{ translateY: slideY }] }]}>
          {/* Order Details */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Order Details</Text>
            <View style={styles.detailsGrid}>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Order Reference</Text>
                <Text style={styles.detailValue}>{orderRef ?? orderId}</Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Estimated Delivery</Text>
                <Text style={styles.detailValue}>1–2 business days</Text>
              </View>
              <View style={styles.detailItem}>
                <Text style={styles.detailLabel}>Payment Status</Text>
                <View style={[styles.statusBadge, view === 'paid' && styles.badgePaid, view === 'expired' && styles.badgeExpired]}>
                  <Text style={[styles.statusText, view === 'paid' && styles.textPaid, view === 'expired' && styles.textExpired]}>
                    {copy.badge}
                  </Text>
                </View>
              </View>
            </View>
            {view === 'pending' && (
              <View style={styles.payActions}>
                <TouchableOpacity style={styles.primaryBtn} onPress={handlePayNow} disabled={paying}>
                  <Text style={styles.primaryBtnText}>{paying ? 'Opening…' : 'Pay now'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPolls(0)}>
                  <Text style={styles.secondaryBtnText}>Check again</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Timeline */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>What happens next?</Text>
            {STEPS.map((step, i) => (
              <View key={step.label} style={styles.timelineStep}>
                <View style={styles.timelineLeft}>
                  <View style={styles.stepNumBadge}>
                    <Text style={styles.stepNum}>{i + 1}</Text>
                  </View>
                  {i < STEPS.length - 1 && <View style={styles.stepLine} />}
                </View>
                <View style={styles.stepContent}>
                  <Text style={styles.stepIcon}>{step.icon}</Text>
                  <Text style={styles.stepLabel}>{step.label}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push('/(tabs)/track')}
            >
              <Text style={styles.primaryBtnText}>📍  Track Order</Text>
            </TouchableOpacity>

            <View style={styles.secondaryRow}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => router.push('/(tabs)/history')}
              >
                <Text style={styles.secondaryBtnText}>View History</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => router.push('/(tabs)/order')}
              >
                <Text style={styles.secondaryBtnText}>Place Another</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function ConfirmationScreen() {
  return (
    <ProtectedScreen>
      <ConfirmationScreenContent />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  scroll: { paddingBottom: 40 },

  heroArea: {
    backgroundColor: Colors.primaryDark,
    paddingTop: 50, paddingBottom: 60,
    paddingHorizontal: Spacing.xxl,
    alignItems: 'center', gap: Spacing.xl,
    overflow: 'hidden',
  },
  checkCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
    ...Shadow.lg,
  },
  checkEmoji: { fontSize: 44, color: Colors.primary },
  heroTitle: {
    fontSize: FontSize.xxxl, fontWeight: '800', color: Colors.white,
    textAlign: 'center', letterSpacing: -0.5,
  },
  heroSub: {
    fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)',
    textAlign: 'center', lineHeight: 20, maxWidth: 280,
  },

  content: {
    marginTop: -24, paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xxl, gap: Spacing.md,
  },

  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  cardTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },

  detailsGrid: { gap: Spacing.sm },
  detailItem: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.md,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  detailLabel: { fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600', marginBottom: 4 },
  detailValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  statusBadge: {
    alignSelf: 'flex-start', backgroundColor: Colors.warningBg,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full,
  },
  statusText: { fontSize: FontSize.xs, color: Colors.warning, fontWeight: '700' },
  badgePaid: { backgroundColor: Colors.successBg },
  textPaid: { color: Colors.success },
  badgeExpired: { backgroundColor: Colors.errorBg },
  textExpired: { color: Colors.error },
  payActions: { gap: Spacing.sm, marginTop: Spacing.md },

  timelineStep: { flexDirection: 'row', gap: Spacing.md, marginBottom: 4 },
  timelineLeft: { alignItems: 'center', width: 28 },
  stepNumBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  stepNum: { fontSize: FontSize.sm, fontWeight: '800', color: Colors.primary },
  stepLine: { width: 2, flex: 1, backgroundColor: Colors.border, marginTop: 4, marginBottom: 4 },
  stepContent: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    gap: Spacing.sm, paddingBottom: Spacing.md,
  },
  stepIcon: { fontSize: 18 },
  stepLabel: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '500', flex: 1 },

  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingVertical: 15, alignItems: 'center', ...Shadow.sm,
  },
  primaryBtnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: '700' },
  secondaryRow: { flexDirection: 'row', gap: Spacing.sm },
  secondaryBtn: {
    flex: 1, backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingVertical: 13, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
  },
  secondaryBtnText: { color: Colors.text, fontSize: FontSize.sm, fontWeight: '600' },
});

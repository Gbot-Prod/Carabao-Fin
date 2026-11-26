// src/screens/ReceiptScreen.tsx
// CF-0135 (M54): the buyer's receipt for a paid order (web orders/[orderId]/receipt).
// Every amount comes from GET /orders/me/:id/receipt; the phone does no money math.
// The web prints; the phone shares a plain-text copy through the system share sheet.
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../lib/AuthContext';
import { api, ApiError, type ApiReceipt } from '../lib/api';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { ProtectedScreen } from '../components/ProtectedScreen';
import { SkeletonList, LoadError } from '../components/Skeleton';
import { parseOrderId } from '../lib/orderDetail';
import {
  RECEIPT_TEXT, receiptFailure, receiptPeso, receiptShareText, receiptSummaryRows, refundNote,
  shortReference, type ReceiptFailure,
} from '../lib/receipt';

type Load = { kind: 'ok'; receipt: ApiReceipt } | { kind: ReceiptFailure };

function fetchReceipt(token: string | null, id: number): Promise<Load> {
  return api.orders
    .receipt(token, id)
    .then((receipt): Load => ({ kind: 'ok', receipt }))
    .catch((err: unknown): Load => ({ kind: receiptFailure(err instanceof ApiError ? err.status : undefined) }));
}

// Same form as the web page (Asia/Manila time).
function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        timeZone: 'Asia/Manila',
      });
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} selectable>{value}</Text>
    </View>
  );
}

function ReceiptContent() {
  const router = useRouter();
  const { token } = useAuth();
  const params = useLocalSearchParams<{ orderId?: string }>();
  const orderId = parseOrderId(params.orderId);
  const [load, setLoad] = useState<Load | null>(orderId === null ? { kind: 'missing' } : null);

  const reload = useCallback(async () => {
    if (orderId === null) return;
    setLoad(await fetchReceipt(token, orderId));
  }, [token, orderId]);

  useEffect(() => {
    if (orderId === null) return;
    let active = true;
    void fetchReceipt(token, orderId).then((r) => { if (active) setLoad(r); });
    return () => { active = false; };
  }, [token, orderId]);

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Back to order">
        <Ionicons name="chevron-back" size={24} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Receipt</Text>
      {load?.kind === 'ok' && (
        <TouchableOpacity
          style={[styles.iconBtn, { marginLeft: 'auto' }]}
          accessibilityRole="button"
          accessibilityLabel="Share receipt"
          onPress={() => {
            const r = load.receipt;
            void Share.share({ message: receiptShareText(r, formatDateTime(r.paid_at)) }).catch(() => undefined);
          }}
        >
          <Ionicons name="share-outline" size={22} color={Colors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );

  if (load === null) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <SkeletonList label="Loading receipt" rows={3} />
      </SafeAreaView>
    );
  }
  if (load.kind === 'error') {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <LoadError message={RECEIPT_TEXT.error} onRetry={() => { setLoad(null); void reload(); }} />
      </SafeAreaView>
    );
  }
  if (load.kind !== 'ok') {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <View style={styles.center}>
          <Ionicons name="receipt-outline" size={44} color={Colors.textLight} />
          <Text style={styles.centerText} accessibilityRole="text">{RECEIPT_TEXT[load.kind]}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const r = load.receipt;
  const note = refundNote(r.payment_status);
  const ref = shortReference(r.payment_reference);

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.brand}>Carabao</Text>
          {r.document_label ? <Text style={styles.cardTitle}>{r.document_label}</Text> : null}
          <Meta label="Receipt no." value={r.receipt_number} />
          <Meta label="Paid" value={formatDateTime(r.paid_at)} />
          <Meta label="Ordered" value={formatDateTime(r.ordered_at)} />
          {ref ? <Meta label="Payment ref." value={ref} /> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sold by</Text>
          <Text style={styles.text}>{r.farm_name ?? '—'}</Text>
          {r.farm_town ? <Text style={styles.muted}>{r.farm_town}</Text> : null}
          {r.farm_contact_number ? <Text style={styles.muted} selectable>{r.farm_contact_number}</Text> : null}
          <View style={styles.divider} />
          <Text style={styles.cardTitle}>Billed to</Text>
          <Text style={styles.text}>{r.buyer_name ?? '—'}</Text>
          {r.delivery_address ? <Text style={styles.muted}>{r.delivery_address}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items</Text>
          {r.lines.map((line, i) => (
            <View key={`${line.name}-${i}`} style={styles.line}>
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>{line.name}{line.unit ? ` (${line.unit})` : ''}</Text>
                <Text style={styles.muted}>{line.quantity} × {receiptPeso(line.unit_price)}</Text>
              </View>
              <Text style={styles.value}>{receiptPeso(line.line_total)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          {receiptSummaryRows(r).map((row) => (
            <View key={row.label} style={styles.row}>
              <Text style={row.total ? styles.totalLabel : styles.label}>{row.label}</Text>
              <Text style={row.total ? styles.totalValue : styles.value}>{row.value}</Text>
            </View>
          ))}
          {note ? <Text style={styles.refund}>{note}</Text> : null}
        </View>

        <Text style={styles.footer}>Paid online through PayMongo. Order #{r.order_id}.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function ReceiptScreen() {
  return (
    <ProtectedScreen>
      <ReceiptContent />
    </ProtectedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  iconBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: 60 },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  brand: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.primary },
  cardTitle: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  text: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  muted: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.md },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  label: { fontSize: FontSize.sm, color: Colors.textMuted },
  value: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.xs },
  totalLabel: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  totalValue: { fontSize: FontSize.md, fontWeight: '800', color: Colors.primary },
  refund: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '700' },
  footer: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  centerText: { fontSize: FontSize.md, color: Colors.text, textAlign: 'center' },
});

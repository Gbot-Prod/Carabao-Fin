// src/components/OrderDetailSheet.tsx
// S4 (plan §5.2): one order as the web merchant OrderCard shows it when expanded —
// buyer, delivery, buyer note, items, the in-transit line and the actions.
// The status buttons come from src/lib/orderActions.ts (nextStatuses), so only the
// moves the web and the API allow are offered. A farm cannot see whether a stop's
// pin is approximate from an order (the API tells the route screen, S11), so no such
// warning is invented here.
import React from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ApiMerchantOrder, MerchantOrderStatus } from '../lib/api';
import { canCancel, nextStatuses } from '../lib/orderActions';
import { orderStatusColor, orderStatusLabel } from '../lib/orderStatus';
import { formatDate, formatPeso } from '../lib/format';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { Badge } from './UI';

// The button text per destination; "cancelled" has its own sheet (needs a reason).
// "delivered" is on the route screen's stop card (drop-off photo), not here.
const STEP_LABELS: Partial<Record<MerchantOrderStatus, string>> = {
  shipped: 'Mark shipped – take photo',
  out_for_delivery: 'Out for delivery',
};

const REFUND_LABELS: Record<string, string> = {
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

type Props = {
  order: ApiMerchantOrder | null;
  busy: boolean;
  onClose: () => void;
  onChat: () => void;
  /** A status move; the screen confirms before sending it. */
  onAdvance: (to: MerchantOrderStatus) => void;
  /** Cancelling needs a reason, so the screen swaps this sheet for CancelOrderSheet. */
  onCancel: () => void;
};

export function OrderDetailSheet({ order, busy, onClose, onChat, onAdvance, onCancel }: Props) {
  const steps = order
    ? nextStatuses(order.status).filter((s) => s !== 'cancelled' && s !== 'delivered')
    : [];
  const canCancelNow = order ? canCancel(order.status) : false;
  const refund = order ? REFUND_LABELS[order.payment_status] : undefined;
  const inTransit = order?.status === 'shipped' || order?.status === 'out_for_delivery';

  return (
    <Modal visible={order != null} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {order && (
            <>
              <View style={styles.header}>
                <Text style={styles.title}>Order #{order.id}</Text>
                <Badge label={orderStatusLabel(order.status)} color={orderStatusColor(order.status)} />
                {refund ? <Badge label={refund} color="gray" /> : null}
                <TouchableOpacity
                  style={styles.close}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close order details"
                >
                  <Ionicons name="close" size={22} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={styles.body}>
                <Field label="Buyer">
                  <Text style={styles.value}>{order.buyer_name ?? '—'}</Text>
                  {order.buyer_email ? <Text style={styles.muted}>{order.buyer_email}</Text> : null}
                  {order.buyer_phone ? <Text style={styles.muted}>{order.buyer_phone}</Text> : null}
                </Field>

                {order.delivery_address ? (
                  <Field label="Deliver to">
                    <Text style={styles.value}>{order.delivery_address}</Text>
                  </Field>
                ) : null}

                <Field label="Ordered">
                  <Text style={styles.value}>{formatDate(order.ordered_at)}</Text>
                </Field>

                {order.notes ? (
                  <Field label="Buyer note">
                    <Text style={styles.note}>{order.notes}</Text>
                  </Field>
                ) : null}

                <View style={styles.items}>
                  {order.items.map((item, i) => (
                    <View key={i} style={styles.item}>
                      <Text style={styles.itemName}>{item.produce ?? item.name ?? 'Item'}</Text>
                      <Text style={styles.itemQty}>×{item.quantity ?? 0}</Text>
                      <Text style={styles.itemPrice}>
                        {typeof item.price === 'number' ? `${formatPeso(item.price)}/${item.unit ?? 'unit'}` : ''}
                      </Text>
                    </View>
                  ))}
                  <View style={[styles.item, styles.totalRow]}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.total}>{formatPeso(order.total_price)}</Text>
                  </View>
                </View>

                {inTransit ? (
                  <Text style={styles.awaiting}>
                    Awaiting delivery: mark it delivered with a photo on the route screen
                    {order.auto_confirm_at ? ` · auto-confirms ${formatDate(order.auto_confirm_at)}` : ''}
                  </Text>
                ) : null}

                {order.packing_photo || order.dropoff_photo ? (
                  <Text style={styles.muted}>
                    {[order.packing_photo && 'Packing photo taken', order.dropoff_photo && 'Drop-off photo taken']
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                ) : null}

                {order.status === 'cancelled' && order.cancel_reason ? (
                  <Field label="Cancel reason">
                    <Text style={styles.value}>{order.cancel_reason}</Text>
                  </Field>
                ) : null}

                {(steps.length > 0 || canCancelNow) && (
                  <View style={styles.actions}>
                    {steps.map((to) => (
                      <TouchableOpacity
                        key={to}
                        style={[styles.primaryBtn, busy && styles.disabled]}
                        disabled={busy}
                        onPress={() => onAdvance(to)}
                        accessibilityRole="button"
                      >
                        <Text style={styles.primaryBtnText}>{STEP_LABELS[to] ?? orderStatusLabel(to)}</Text>
                      </TouchableOpacity>
                    ))}
                    {canCancelNow ? (
                      <TouchableOpacity
                        style={[styles.cancelBtn, busy && styles.disabled]}
                        disabled={busy}
                        onPress={onCancel}
                        accessibilityRole="button"
                      >
                        <Text style={styles.cancelBtnText}>Cancel order</Text>
                      </TouchableOpacity>
                    ) : null}
                    {busy ? <ActivityIndicator color={Colors.primary} /> : null}
                  </View>
                )}

                <TouchableOpacity style={styles.chatBtn} onPress={onChat} accessibilityRole="button">
                  <Ionicons name="chatbubble-outline" size={18} color={Colors.primaryDark} />
                  <Text style={styles.chatBtnText}>Open chat</Text>
                </TouchableOpacity>
              </ScrollView>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.white, maxHeight: '90%',
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  close: { marginLeft: 'auto', padding: 4 },
  body: { padding: Spacing.lg, gap: Spacing.md },
  field: { gap: 2 },
  label: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.4 },
  value: { fontSize: FontSize.md, color: Colors.text, lineHeight: 21 },
  muted: { fontSize: FontSize.sm, color: Colors.textMuted },
  note: { fontSize: FontSize.sm, color: Colors.text, fontStyle: 'italic', lineHeight: 20 },
  items: { gap: 6, borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: Spacing.md },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemName: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  itemQty: { fontSize: FontSize.sm, color: Colors.textMuted },
  itemPrice: { fontSize: FontSize.sm, color: Colors.text },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 6, marginTop: 2 },
  totalLabel: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  total: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  awaiting: { fontSize: FontSize.sm, color: Colors.warning, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, minHeight: 40, justifyContent: 'center',
  },
  primaryBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  cancelBtn: {
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.error,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, minHeight: 40, justifyContent: 'center',
  },
  cancelBtnText: { color: Colors.error, fontWeight: '700', fontSize: FontSize.sm },
  disabled: { opacity: 0.5 },
  chatBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 48, borderRadius: Radius.md, backgroundColor: Colors.primaryLight,
  },
  chatBtnText: { color: Colors.primaryDark, fontWeight: '700', fontSize: FontSize.md },
});

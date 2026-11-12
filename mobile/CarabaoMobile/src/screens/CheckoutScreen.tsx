// src/screens/CheckoutScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCart } from '../lib/CartContext';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';
import { cartTotals, groupCartByFarm, type PendingOrder } from '../lib/cartGroups';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Button, Divider, StatRow } from '../components/UI';
import { ProtectedScreen } from '../components/ProtectedScreen';

// Matches the web checkout: every order is paid through PayMongo's hosted
// checkout, where the buyer picks GCash, Maya, card, etc.
const PAYMENT_METHODS = [
  { id: 'online', label: 'Online payment (GCash, Maya, card via PayMongo)', icon: '💳' },
];

const TIME_WINDOWS = [
  '08:00 – 10:00', '10:00 – 12:00', '13:00 – 15:00', '16:00 – 18:00',
];

function CheckoutScreenContent() {
  const router = useRouter();
  const { items, clearCart } = useCart();
  const { token } = useAuth();
  const [payment, setPayment] = useState('online');
  const [timeWindow, setTimeWindow] = useState(TIME_WINDOWS[0]);
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  // One order per farm (C1), each with that farm's delivery fee.
  const groups = groupCartByFarm(items);
  const { itemTotal: total, deliveryTotal, grandTotal } = cartTotals(groups);

  const handlePlaceOrder = async () => {
    if (!token) {
      Alert.alert('Sign In Required', 'Please sign in to place an order.');
      return;
    }
    if (items.length === 0) {
      Alert.alert('Cart Empty', 'Add some produce before checking out.');
      return;
    }
    setLoading(true);
    try {
      // The backend places orders from the server-side cart, so sync the
      // local cart first; otherwise it fails with "Cart is empty".
      await api.cart.replace(
        token,
        items.map((i) => ({
          id: i.id,
          produce_id: i.produceId,
          merchant_id: i.merchantId,
          produce: i.produce,
          farm: i.farm,
          unit: i.unit,
          price: i.price,
          quantity: i.quantity,
        })),
      );
      const result = await api.orders.place(token, {
        delivery_address: address.trim() || null,
        delivery_time: timeWindow,
        payment_method: payment,
        notes: notes.trim() || null,
        // Ignored by the server, which charges each farm's own delivery fee.
        service_fee: deliveryTotal,
      });
      // PayMongo takes one order per checkout: pay the first here, the
      // confirmation screen lists the other farms' orders to pay in turn.
      const placed = result.orders?.length ? result.orders : null;
      const first = placed ? placed[0] : { order_id: result.order_id, order_reference: result.order_reference };
      const more: PendingOrder[] = (placed ?? []).slice(1).map((o) => ({
        id: o.order_id,
        ref: o.order_reference,
        farm: o.merchant_name,
        total: o.total_price,
      }));
      clearCart();
      // The order exists now, so go to confirmation even if PayMongo fails;
      // that screen polls the transaction and offers "Pay now" to retry.
      try {
        const checkout = await api.payments.checkout(token, first.order_id);
        // Resolves when the buyer closes the browser (PayMongo's redirect
        // lands on the web site, not the app).
        await WebBrowser.openBrowserAsync(checkout.checkout_url);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not start payment';
        Alert.alert('Payment not started', message);
      }
      router.replace({
        pathname: '/confirmation',
        params: {
          orderId: String(first.order_id),
          orderRef: first.order_reference,
          ...(more.length ? { more: JSON.stringify(more) } : {}),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to place order';
      Alert.alert('Order Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Checkout</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Delivery Info */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="location-outline" size={16} color={Colors.text} />
            <Text style={styles.sectionTitle}> Delivery Information</Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Delivery Address</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={address}
              onChangeText={setAddress}
              multiline
              numberOfLines={3}
              placeholder="Street, barangay, city, province"
              placeholderTextColor={Colors.textLight}
            />
            {/* The server checks the address is in Luzon (B2). */}
            <Text style={styles.fieldHint}>
              Carabao delivers within Luzon only. Include your province or Metro Manila city.
            </Text>
          </View>

          <Text style={styles.fieldLabel}>Time Window</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.timeScroll}>
            {TIME_WINDOWS.map((tw) => (
              <TouchableOpacity
                key={tw}
                style={[styles.timePill, timeWindow === tw && styles.timePillActive]}
                onPress={() => setTimeWindow(tw)}
              >
                <Text style={[styles.timePillText, timeWindow === tw && styles.timePillTextActive]}>
                  {tw}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Payment */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="card-outline" size={16} color={Colors.text} />
            <Text style={styles.sectionTitle}> Payment Method</Text>
          </View>
          {PAYMENT_METHODS.map((pm) => (
            <TouchableOpacity
              key={pm.id}
              style={[styles.payRow, payment === pm.id && styles.payRowActive]}
              onPress={() => setPayment(pm.id)}
            >
              <View style={[styles.radio, payment === pm.id && styles.radioActive]}>
                {payment === pm.id && <View style={styles.radioDot} />}
              </View>
              <Text style={styles.payIcon}>{pm.icon}</Text>
              <Text style={[styles.payLabel, payment === pm.id && styles.payLabelActive]}>
                {pm.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Notes */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="create-outline" size={16} color={Colors.text} />
            <Text style={styles.sectionTitle}> Order Notes</Text>
          </View>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Gate instructions, handling requests, preferred contact method..."
            placeholderTextColor={Colors.textLight}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Order Summary */}
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Ionicons name="receipt-outline" size={16} color={Colors.text} />
            <Text style={styles.sectionTitle}> Order Summary</Text>
          </View>
          {groups.map((group) => (
            <View key={group.key} style={styles.farmGroup}>
              {groups.length > 1 && <Text style={styles.farmGroupName}>{group.farm}</Text>}
              {group.items.map((item) => (
                <StatRow
                  key={item.id}
                  label={`${item.quantity}x ${item.produce}`}
                  value={`₱${(item.quantity * item.price).toLocaleString()}`}
                />
              ))}
              <StatRow
                label={groups.length > 1 ? `Delivery from ${group.farm}` : 'Delivery fee'}
                value={`₱${group.deliveryFee.toLocaleString()}`}
              />
            </View>
          ))}
          <Divider />
          <StatRow label="Items subtotal" value={`₱${total.toLocaleString()}`} />
          <StatRow
            label={groups.length > 1 ? `Delivery fees (${groups.length} farms)` : 'Delivery fee'}
            value={`₱${deliveryTotal.toLocaleString()}`}
          />
          {groups.length > 1 && (
            <Text style={styles.fieldHint}>
              This creates {groups.length} orders, one per farm. You'll pay for each in turn.
            </Text>
          )}
          <Divider style={{ marginTop: Spacing.sm }} />
          <StatRow label="Total" value={`₱${grandTotal.toLocaleString()}`} bold />
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Place Order footer */}
      <View style={styles.footer}>
        <View style={styles.footerTotal}>
          <Text style={styles.footerLabel}>Total to pay</Text>
          <Text style={styles.footerAmount}>₱{grandTotal.toLocaleString()}</Text>
        </View>
        <Button
          label="Place Order"
          onPress={handlePlaceOrder}
          loading={loading}
          style={styles.placeBtn}
        />
      </View>
    </SafeAreaView>
  );
}

export default function CheckoutScreen() {
  return (
    <ProtectedScreen>
      <CheckoutScreenContent />
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

  scroll: { padding: Spacing.lg, gap: Spacing.md },

  section: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },

  fieldGroup: { marginBottom: Spacing.md },
  farmGroup: { marginBottom: Spacing.sm },
  farmGroupName: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  fieldHint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: 4 },
  fieldLabel: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginBottom: 6 },

  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 11,
    fontSize: FontSize.sm, color: Colors.text, backgroundColor: Colors.surfaceAlt,
  },
  textArea: { textAlignVertical: 'top', minHeight: 72 },

  timeScroll: { marginTop: Spacing.sm },
  timePill: {
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border,
    marginRight: Spacing.sm, backgroundColor: Colors.white,
  },
  timePillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  timePillText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '500' },
  timePillTextActive: { color: Colors.white, fontWeight: '700' },

  payRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.border, marginBottom: Spacing.sm,
  },
  payRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: Colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  payIcon: { fontSize: 20 },
  payLabel: { fontSize: FontSize.md, color: Colors.textMuted, fontWeight: '500' },
  payLabelActive: { color: Colors.text, fontWeight: '700' },

  footer: {
    padding: Spacing.lg, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.border,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, ...Shadow.md,
  },
  footerTotal: { flex: 1 },
  footerLabel: { fontSize: FontSize.xs, color: Colors.textMuted },
  footerAmount: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  placeBtn: { flex: 1 },
});

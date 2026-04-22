// src/screens/CheckoutScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, SafeAreaView, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCart } from '../lib/CartContext';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Button, Divider, StatRow } from '../components/UI';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PAYMENT_METHODS = [
  { id: 'cod', label: 'Cash on Delivery', icon: '💵' },
  { id: 'gcash', label: 'GCash', icon: '📱' },
  { id: 'bank', label: 'Bank Transfer', icon: '🏦' },
];

const TIME_WINDOWS = [
  '08:00 – 10:00', '10:00 – 12:00', '13:00 – 15:00', '16:00 – 18:00',
];

export default function CheckoutScreen() {
  const navigation = useNavigation<Nav>();
  const { items, total, clearCart } = useCart();
  const [payment, setPayment] = useState('cod');
  const [timeWindow, setTimeWindow] = useState(TIME_WINDOWS[0]);
  const [address, setAddress] = useState('Brgy. Poblacion, Science City of Munoz, Nueva Ecija');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const serviceFee = 40;
  const grandTotal = total + serviceFee;

  const handlePlaceOrder = async () => {
    setLoading(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    clearCart();
    const orderId = `CB-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`;
    navigation.replace('Confirmation', { orderId });
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backIcon}>←</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Checkout</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Delivery Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📍 Delivery Information</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Delivery Address</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={address}
              onChangeText={setAddress}
              multiline
              numberOfLines={3}
              placeholder="Enter your delivery address"
              placeholderTextColor={Colors.textLight}
            />
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
          <Text style={styles.sectionTitle}>💳 Payment Method</Text>
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
          <Text style={styles.sectionTitle}>📝 Order Notes</Text>
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
          <Text style={styles.sectionTitle}>🧾 Order Summary</Text>
          {items.map((item) => (
            <StatRow
              key={item.id}
              label={`${item.quantity}x ${item.produce}`}
              value={`₱${(item.quantity * item.price).toLocaleString()}`}
            />
          ))}
          <Divider />
          <StatRow label="Items subtotal" value={`₱${total.toLocaleString()}`} />
          <StatRow label="Service fee" value={`₱${serviceFee}`} />
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
  sectionTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },

  fieldGroup: { marginBottom: Spacing.md },
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

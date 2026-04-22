// src/screens/CartScreen.tsx
import React from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, SafeAreaView, Image, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCart } from '../lib/CartContext';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { RootStackParamList } from '../types';
import { StatRow, Divider, Button, EmptyState } from '../components/UI';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function CartScreen() {
  const navigation = useNavigation<Nav>();
  const { items, updateQuantity, removeItem, total, itemCount, clearCart } = useCart();

  const serviceFee = total > 0 ? 40 : 0;
  const grandTotal = total + serviceFee;

  const handleCheckout = () => {
    if (items.length === 0) return;
    navigation.navigate('Checkout');
  };

  const handleRemove = (id: string, name: string) => {
    Alert.alert(
      'Remove item?',
      `Remove "${name}" from your cart?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeItem(id) },
      ]
    );
  };

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Your Cart</Text>
        </View>
        <EmptyState
          icon="🛒"
          title="Your cart is empty"
          message="Add fresh produce from farms to get started"
          action={
            <TouchableOpacity
              style={styles.browseBtn}
              onPress={() => (navigation as any).navigate('Order')}
            >
              <Text style={styles.browseBtnText}>Browse Farms</Text>
            </TouchableOpacity>
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Your Cart</Text>
        <TouchableOpacity onPress={() => Alert.alert('Clear cart?', 'Remove all items?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Clear All', style: 'destructive', onPress: clearCart },
        ])}>
          <Text style={styles.clearBtn}>Clear all</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemFarm}>{item.farm}</Text>
              <Text style={styles.itemName}>{item.produce}</Text>
              <Text style={styles.itemPrice}>₱{item.price.toLocaleString()} / {item.unit}</Text>
            </View>

            <View style={styles.itemActions}>
              {/* Quantity control */}
              <View style={styles.qtyControl}>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateQuantity(item.id, item.quantity - 1)}
                >
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.qtyValue}>{item.quantity}</Text>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateQuantity(item.id, item.quantity + 1)}
                >
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.itemBottom}>
                <Text style={styles.lineTotal}>
                  ₱{(item.price * item.quantity).toLocaleString()}
                </Text>
                <TouchableOpacity onPress={() => handleRemove(item.id, item.produce)}>
                  <Text style={styles.removeBtn}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
        ListFooterComponent={
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>Order Summary</Text>
            <StatRow label={`Items (${itemCount})`} value={`₱${total.toLocaleString()}`} />
            <StatRow label="Service fee" value={`₱${serviceFee.toLocaleString()}`} />
            <Divider style={{ marginVertical: Spacing.sm }} />
            <StatRow label="Grand Total" value={`₱${grandTotal.toLocaleString()}`} bold />
          </View>
        }
      />

      {/* Bottom CTA */}
      <View style={styles.footer}>
        <Button
          label={`Proceed to Checkout  ₱${grandTotal.toLocaleString()}`}
          onPress={handleCheckout}
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: FontSize.xxl, fontWeight: '800', color: Colors.text },
  clearBtn: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '600' },

  listContent: { padding: Spacing.lg, gap: Spacing.md },

  itemCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, ...Shadow.sm,
  },
  itemInfo: { marginBottom: Spacing.md },
  itemFarm: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '700', textTransform: 'uppercase' },
  itemName: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  itemPrice: { fontSize: FontSize.sm, color: Colors.textMuted },

  itemActions: { gap: Spacing.sm },
  qtyControl: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.offWhite, borderRadius: Radius.md,
    overflow: 'hidden', alignSelf: 'flex-start',
    borderWidth: 1, borderColor: Colors.border,
  },
  qtyBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  qtyBtnText: { fontSize: FontSize.xl, color: Colors.text, fontWeight: '300' },
  qtyValue: {
    width: 40, textAlign: 'center',
    fontSize: FontSize.md, fontWeight: '700', color: Colors.text,
  },
  itemBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  lineTotal: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  removeBtn: { fontSize: FontSize.sm, color: Colors.error, fontWeight: '600' },

  summary: {
    backgroundColor: Colors.white, borderRadius: Radius.lg,
    padding: Spacing.lg, marginTop: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.sm,
  },
  summaryTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },

  footer: {
    padding: Spacing.lg, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.border, ...Shadow.md,
  },

  browseBtn: {
    backgroundColor: Colors.primary, paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md, borderRadius: Radius.md, marginTop: Spacing.md,
  },
  browseBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.md },
});

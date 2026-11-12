// src/components/ListingForm.tsx
// Edit form for one produce listing, shown in a modal from My listings.
// Field rules mirror backend ProduceUpdate (app/schemas/produce.py):
// price and stock are whole numbers, unit is kg|lbs, category is Vegetables|Fruits.
import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { Button } from './UI';
import type {
  ApiProduce, ProduceCategory, ProduceUnit, ProduceUpdatePayload,
} from '../lib/api';

const UNITS: ProduceUnit[] = ['kg', 'lbs'];
const CATEGORIES: ProduceCategory[] = ['Vegetables', 'Fruits'];

type Props = {
  produce: ApiProduce | null; // null = closed
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (payload: ProduceUpdatePayload) => void;
};

function parseWhole(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

export function ListingForm({ produce, saving, error, onCancel, onSave }: Props) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [unit, setUnit] = useState<ProduceUnit>('kg');
  const [category, setCategory] = useState<ProduceCategory | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!produce) return;
    setName(produce.name ?? '');
    setPrice(String(produce.price));
    setStock(String(produce.stock_quantity));
    setUnit(produce.unit === 'lbs' ? 'lbs' : 'kg');
    setCategory(
      produce.category === 'Vegetables' || produce.category === 'Fruits' ? produce.category : null,
    );
    setLocalError(null);
  }, [produce]);

  const handleSave = () => {
    const parsedPrice = parseWhole(price);
    const parsedStock = parseWhole(stock);
    if (!name.trim()) return setLocalError('Name is required.');
    if (parsedPrice === null || parsedPrice <= 0) {
      return setLocalError('Price must be a whole number of pesos above 0.');
    }
    if (parsedStock === null) return setLocalError('Stock must be a whole number (0 or more).');
    setLocalError(null);
    onSave({
      name: name.trim(),
      price: parsedPrice,
      stock_quantity: parsedStock,
      unit,
      category,
    });
  };

  const shownError = localError ?? error;

  return (
    <Modal visible={!!produce} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Edit listing</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} />

            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={styles.label}>Price (₱)</Text>
                <TextInput
                  style={styles.input} value={price} onChangeText={setPrice}
                  keyboardType="number-pad"
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Stock</Text>
                <TextInput
                  style={styles.input} value={stock} onChangeText={setStock}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <Text style={styles.label}>Unit</Text>
            <View style={styles.pills}>
              {UNITS.map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[styles.pill, unit === u && styles.pillActive]}
                  onPress={() => setUnit(u)}
                >
                  <Text style={[styles.pillText, unit === u && styles.pillTextActive]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Category</Text>
            <View style={styles.pills}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.pill, category === c && styles.pillActive]}
                  onPress={() => setCategory(category === c ? null : c)}
                >
                  <Text style={[styles.pillText, category === c && styles.pillTextActive]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {shownError ? <Text style={styles.error}>{shownError}</Text> : null}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Button label="Save" onPress={handleSave} loading={saving} style={styles.saveBtn} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.white, padding: Spacing.lg, maxHeight: '90%',
    borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg,
  },
  title: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text, marginBottom: Spacing.md },
  label: {
    fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600',
    marginBottom: 6, marginTop: Spacing.md,
  },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 11,
    fontSize: FontSize.sm, color: Colors.text, backgroundColor: Colors.surfaceAlt,
  },
  twoCol: { flexDirection: 'row', gap: Spacing.md },
  col: { flex: 1 },
  pills: { flexDirection: 'row', gap: Spacing.sm },
  pill: {
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '500' },
  pillTextActive: { color: Colors.white, fontWeight: '700' },
  error: { color: Colors.error, fontSize: FontSize.sm, marginTop: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl, alignItems: 'center' },
  cancelBtn: {
    flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  cancelText: { color: Colors.text, fontWeight: '600', fontSize: FontSize.sm },
  saveBtn: { flex: 1 },
});

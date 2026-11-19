// src/components/ListingForm.tsx
// Create/edit form for one produce listing, shown in a modal from My listings.
// Field rules mirror backend ProduceUpdate (app/schemas/produce.py):
// price and stock are whole numbers, unit is kg|lbs, category is Vegetables|Fruits.
// CF-0107: harvest and best-before dates are required by the backend on create and
// on every edit (services/produce_freshness.py); checks are in src/lib/listingForm.ts.
import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { Button } from './UI';
import { addDays, checkListing, LISTING_TIERS_MAX, phToday, type TierFields } from '../lib/listingForm';
import type {
  ApiProduce, ProduceCategory, ProduceCreatePayload, ProduceUnit,
} from '../lib/api';

const UNITS: ProduceUnit[] = ['kg', 'lbs'];
const CATEGORIES: ProduceCategory[] = ['Vegetables', 'Fruits'];

type Props = {
  visible: boolean;
  produce: ApiProduce | null; // null = new listing
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  // Every field is always sent, so the same payload works for POST and PATCH.
  onSave: (payload: ProduceCreatePayload) => void;
  /** Edit mode only: delete the listing (asks first). CF-0116. */
  onDelete?: () => void;
  /** CF-0123: the server's message per field (backend names), shown under the field. */
  fieldErrors?: Record<string, string>;
};

export function ListingForm({ visible, produce, saving, error, onCancel, onSave, onDelete, fieldErrors = {} }: Props) {
  const fieldNote = (key: string) =>
    fieldErrors[key] ? <Text style={styles.fieldError}>{fieldErrors[key]}</Text> : null;
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [unit, setUnit] = useState<ProduceUnit>('kg');
  const [category, setCategory] = useState<ProduceCategory | null>(null);
  const [harvestDate, setHarvestDate] = useState('');
  const [bestBefore, setBestBefore] = useState('');
  const [minOrderQty, setMinOrderQty] = useState('1');
  const [tiers, setTiers] = useState<TierFields[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  // CF-0101: reset the fields when the sheet opens or the listing changes. Done during
  // render (React's "adjust state on prop change"), not in an effect.
  const [shownFor, setShownFor] = useState<{ visible: boolean; produce: Props['produce'] } | null>(null);
  if (!shownFor || shownFor.visible !== visible || shownFor.produce !== produce) {
    setShownFor({ visible, produce });
    if (visible) {
      setName(produce?.name ?? '');
      setPrice(produce ? String(produce.price) : '');
      setStock(produce ? String(produce.stock_quantity) : '');
      setUnit(produce?.unit === 'lbs' ? 'lbs' : 'kg');
      setCategory(
        produce?.category === 'Vegetables' || produce?.category === 'Fruits' ? produce.category : null,
      );
      // A listing from before the dates existed has none: start from today / +7 days.
      const today = phToday();
      setHarvestDate(produce?.harvest_date ?? today);
      setBestBefore(produce?.best_before ?? addDays(today, 7));
      setMinOrderQty(String(produce?.min_order_qty ?? 1));
      setTiers((produce?.price_tiers ?? []).map((t) => ({ minQty: String(t.min_qty), unitPrice: String(t.unit_price) })));
      setLocalError(null);
    }
  }

  const handleSave = () => {
    const result = checkListing({ name, price, stock, harvestDate, bestBefore, minOrderQty, tiers }, phToday());
    if ('error' in result) return setLocalError(result.error);
    setLocalError(null);
    onSave({ ...result.ok, unit, category });
  };

  const today = phToday();
  const dateChip = (label: string, value: string, set: (v: string) => void, current: string) => (
    <TouchableOpacity
      key={label}
      style={[styles.pill, current === value && styles.pillActive]}
      onPress={() => set(value)}
      accessibilityRole="button"
      accessibilityState={{ selected: current === value }}
    >
      <Text style={[styles.pillText, current === value && styles.pillTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  const shownError = localError ?? error;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{produce ? 'Edit listing' : 'New listing'}</Text>

            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} />
            {fieldNote('name')}

            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={styles.label}>Price (₱)</Text>
                <TextInput
                  style={styles.input} value={price} onChangeText={setPrice}
                  keyboardType="number-pad"
                />
                {fieldNote('price')}
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Stock</Text>
                <TextInput
                  style={styles.input} value={stock} onChangeText={setStock}
                  keyboardType="number-pad"
                />
                {fieldNote('stock_quantity')}
              </View>
            </View>

            <Text style={styles.label}>Harvest date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input} value={harvestDate} onChangeText={setHarvestDate}
              placeholder={today} placeholderTextColor={Colors.textLight}
              autoCapitalize="none" autoCorrect={false} maxLength={10}
              keyboardType="numbers-and-punctuation" accessibilityLabel="Harvest date, year-month-day"
            />
            {fieldNote('harvest_date')}
            <View style={[styles.pills, styles.chipRow]}>
              {dateChip('Today', today, setHarvestDate, harvestDate)}
              {dateChip('Yesterday', addDays(today, -1), setHarvestDate, harvestDate)}
            </View>

            <Text style={styles.label}>Best before (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input} value={bestBefore} onChangeText={setBestBefore}
              placeholder={addDays(today, 7)} placeholderTextColor={Colors.textLight}
              autoCapitalize="none" autoCorrect={false} maxLength={10}
              keyboardType="numbers-and-punctuation" accessibilityLabel="Best-before date, year-month-day"
            />
            {fieldNote('best_before')}
            <View style={[styles.pills, styles.chipRow]}>
              {[3, 7, 14].map((n) => dateChip(`+${n} days`, addDays(today, n), setBestBefore, bestBefore))}
            </View>
            <Text style={styles.hint}>Buyers stop seeing the listing after its best-before date.</Text>

            <Text style={styles.label}>Minimum order (sale units)</Text>
            <TextInput
              style={styles.input} value={minOrderQty} onChangeText={setMinOrderQty}
              keyboardType="number-pad" accessibilityLabel="Minimum order quantity"
            />
            {fieldNote('min_order_qty')}

            <Text style={styles.label}>Bulk prices (optional)</Text>
            <Text style={styles.hint}>A lower price per unit once a buyer orders this many or more.</Text>
            {tiers.map((t, i) => (
              <View key={i} style={[styles.twoCol, styles.tierRow]}>
                <TextInput
                  style={[styles.input, styles.col]} value={t.minQty} placeholder="From qty"
                  placeholderTextColor={Colors.textLight} keyboardType="number-pad"
                  onChangeText={(v) => setTiers((p) => p.map((x, j) => (j === i ? { ...x, minQty: v } : x)))}
                  accessibilityLabel={`Bulk price ${i + 1}, from quantity`}
                />
                <TextInput
                  style={[styles.input, styles.col]} value={t.unitPrice} placeholder="₱ per unit"
                  placeholderTextColor={Colors.textLight} keyboardType="number-pad"
                  onChangeText={(v) => setTiers((p) => p.map((x, j) => (j === i ? { ...x, unitPrice: v } : x)))}
                  accessibilityLabel={`Bulk price ${i + 1}, pesos per unit`}
                />
                <TouchableOpacity
                  style={styles.tierRemove}
                  onPress={() => setTiers((p) => p.filter((_, j) => j !== i))}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove bulk price ${i + 1}`}
                >
                  <Text style={styles.tierRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            {fieldNote('price_tiers')}
            {tiers.length < LISTING_TIERS_MAX && (
              <TouchableOpacity
                style={styles.addTier}
                onPress={() => setTiers((p) => [...p, { minQty: '', unitPrice: '' }])}
                accessibilityRole="button"
              >
                <Text style={styles.addTierText}>+ Add bulk price</Text>
              </TouchableOpacity>
            )}

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
            {produce && onDelete ? (
              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} disabled={saving} accessibilityRole="button">
                <Text style={styles.deleteText}>Delete listing</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Button label={produce ? 'Save' : 'Create'} onPress={handleSave} loading={saving} style={styles.saveBtn} />
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
  chipRow: { marginTop: Spacing.sm, flexWrap: 'wrap' },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.xs },
  tierRow: { alignItems: 'center', marginTop: Spacing.sm },
  tierRemove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  tierRemoveText: { fontSize: FontSize.lg, color: Colors.textMuted },
  addTier: { minHeight: 44, justifyContent: 'center' },
  addTierText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  deleteBtn: { minHeight: 44, justifyContent: 'center', alignItems: 'center', marginTop: Spacing.lg },
  deleteText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.error },
  pillText: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '500' },
  pillTextActive: { color: Colors.white, fontWeight: '700' },
  error: { color: Colors.error, fontSize: FontSize.sm, marginTop: Spacing.md },
  fieldError: { color: Colors.error, fontSize: FontSize.xs, marginTop: 4 },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl, alignItems: 'center' },
  cancelBtn: {
    flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  cancelText: { color: Colors.text, fontWeight: '600', fontSize: FontSize.sm },
  saveBtn: { flex: 1 },
});

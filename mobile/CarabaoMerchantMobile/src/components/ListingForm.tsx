// src/components/ListingForm.tsx
// Create/edit form for one produce listing, shown in a modal from My listings.
// Field rules mirror backend ProduceUpdate (app/schemas/produce.py):
// price and stock are whole numbers, unit is always kg, category is Vegetables|Fruits.
// CF-0107: harvest and best-before dates are required by the backend on create and
// on every edit (services/produce_freshness.py); checks are in src/lib/listingForm.ts.
// S6 (plan §5.7): the photo is picked here (camera or library) and uploaded by the
// screen after the listing is saved, so a new listing has an id first. Server
// messages for a field show under that field (rule 8), the photo's included.
import React, { useEffect, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { Button } from './UI';
import {
  addDays, checkListing, LISTING_NAME_MAX, LISTING_TIERS_MAX, phToday,
  type ListingFieldErrors, type PickedPhoto, type TierFields,
} from '../lib/listingForm';
import { checkImage, imageMimeType } from '../lib/uploads';
import {
  CHECK_DELAY_MS, checkNotes, checkPayload, hasBlocks, marketPriceNote, type ProduceCheckResult,
} from '../lib/listingChecks';
import { safeImageUri } from '../lib/imageUri';
import type {
  ApiProduce, ProduceCategory, ProduceCreatePayload, ProduceUnit,
} from '../lib/api';

// A soft flag's text: a darker amber than Colors.warning, readable on white.
const FLAG_TEXT = '#b45309';

// Listings are sold in kg only: the form has no unit choice.
const UNIT: ProduceUnit = 'kg';
const CATEGORIES: ProduceCategory[] = ['Vegetables', 'Fruits'];

// One photo, as the web input takes it (ProduceTab.tsx: PNG, JPG or WebP): no crop,
// compressed a little on the phone; the server re-encodes it anyway.
const PHOTO_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.8,
  exif: false,
};

type Props = {
  visible: boolean;
  produce: ApiProduce | null; // null = new listing
  saving: boolean;
  /** S6: the photo is uploading after the listing was saved. */
  uploading?: boolean;
  /** Shown at the top (rule 8): a network/500 message, or one the form cannot place. */
  error: string | null;
  onCancel: () => void;
  /** Every field is always sent, so the same payload works for POST and PATCH. */
  onSave: (payload: ProduceCreatePayload, photo: PickedPhoto | null) => void;
  /** Edit mode only: delete the listing (asks first). CF-0116. */
  onDelete?: () => void;
  /** CF-0123, rule 8: the server's message per form field, shown under the field. */
  fieldErrors?: ListingFieldErrors;
  /** S6: why the last photo upload failed; shown under the photo. */
  photoError?: string | null;
  /** Guardrails Phase 1: POST /produce/check. Without it the form does not check live. */
  onCheck?: (payload: ReturnType<typeof checkPayload>) => Promise<ProduceCheckResult>;
};

export function ListingForm({
  visible, produce, saving, uploading = false, error, onCancel, onSave, onDelete,
  fieldErrors = {}, photoError = null, onCheck,
}: Props) {
  // The form's own checks and the server's messages both land under their field (rule 8).
  // Guardrails: then the live checker's block (red) and flag (amber).
  const fieldNote = (key: keyof ListingFieldErrors) => {
    const message = fieldErrors[key] ?? localFields[key] ?? notes.blocks[key];
    const flag = notes.flags[key];
    return (
      <>
        {message ? <Text style={styles.fieldError}>{message}</Text> : null}
        {flag ? <Text style={styles.fieldFlag}>{flag}</Text> : null}
      </>
    );
  };
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const unit = UNIT;
  const [category, setCategory] = useState<ProduceCategory | null>(null);
  const [harvestDate, setHarvestDate] = useState('');
  const [bestBefore, setBestBefore] = useState('');
  const [minOrderQty, setMinOrderQty] = useState('1');
  const [tiers, setTiers] = useState<TierFields[]>([]);
  // The form's own check messages, keyed like the server's (see fieldNote).
  const [localFields, setLocalFields] = useState<ListingFieldErrors>({});
  // S6: the photo picked here, and why the last pick failed.
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [photoProblem, setPhotoProblem] = useState<string | null>(null);
  // Guardrails Phase 1: the live check, CHECK_DELAY_MS after the last change.
  const [checked, setChecked] = useState<ProduceCheckResult | null>(null);
  const payloadKey = JSON.stringify(
    visible
      ? checkPayload({ name, price, stock, harvestDate, bestBefore, minOrderQty, tiers, unit, category, unitQuantity: produce?.unit_quantity }, produce?.id ?? null)
      : null,
  );
  useEffect(() => {
    if (!onCheck || payloadKey === 'null') return;
    // An answer for a form that changed since is dropped (stale).
    let stale = false;
    const timer = setTimeout(() => {
      onCheck(JSON.parse(payloadKey))
        .then((r) => {
          if (!stale) setChecked(r);
        })
        .catch(() => {
          // A failed check shows nothing: the save checks again.
          if (!stale) setChecked(null);
        });
    }, CHECK_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [onCheck, payloadKey]);
  const notes = checkNotes(visible ? checked : null);
  const market = marketPriceNote(visible ? checked?.market_price : null);

  // CF-0101: reset the fields when the sheet opens or the listing changes. Done during
  // render (React's "adjust state on prop change"), not in an effect.
  const [shownFor, setShownFor] = useState<{ visible: boolean; produce: Props['produce'] } | null>(null);
  if (!shownFor || shownFor.visible !== visible || shownFor.produce !== produce) {
    setShownFor({ visible, produce });
    if (visible) {
      setName(produce?.name ?? '');
      setPrice(produce ? String(produce.price) : '');
      setStock(produce ? String(produce.stock_quantity) : '');
      setCategory(
        produce?.category === 'Vegetables' || produce?.category === 'Fruits' ? produce.category : null,
      );
      // A listing from before the dates existed has none: start from today / +7 days.
      const today = phToday();
      setHarvestDate(produce?.harvest_date ?? today);
      setBestBefore(produce?.best_before ?? addDays(today, 7));
      setMinOrderQty(String(produce?.min_order_qty ?? 1));
      setTiers((produce?.price_tiers ?? []).map((t) => ({ minQty: String(t.min_qty), unitPrice: String(t.unit_price) })));
      setLocalFields({});
      setPhoto(null);
      setPhotoProblem(null);
      setChecked(null);
    }
  }

  // S6: pick from the library or the camera, checked with the web's rules (S2 checkImage)
  // before anything is sent. The screen uploads it after the listing is saved.
  const pickPhoto = async (from: 'library' | 'camera') => {
    setPhotoProblem(null);
    try {
      const permission = from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setPhotoProblem(from === 'camera'
          ? 'Allow camera access in your phone settings to take a photo.'
          : 'Allow photo access in your phone settings to choose a photo.');
        return;
      }
      const result = from === 'camera'
        ? await ImagePicker.launchCameraAsync(PHOTO_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(PHOTO_OPTIONS);
      const asset = result.canceled ? undefined : result.assets?.[0];
      if (!asset) return;
      // The camera can leave the type out; the file name makes up for it.
      const mimeType = imageMimeType(asset.uri, asset.mimeType);
      const problem = checkImage({ size: asset.fileSize, mimeType });
      if (problem) {
        setPhotoProblem(problem);
        return;
      }
      setPhoto({ uri: asset.uri, name: asset.fileName, mimeType });
    } catch {
      setPhotoProblem('The photo could not be opened. Try again.');
    }
  };

  const handleSave = () => {
    const result = checkListing({ name, price, stock, harvestDate, bestBefore, minOrderQty, tiers, unitQuantity: produce?.unit_quantity }, phToday());
    if ('error' in result) {
      setLocalFields({ [result.field]: result.error });
      return;
    }
    setLocalFields({});
    onSave({ ...result.ok, unit, category }, photo);
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

  // S6: the stored photo (only a plain https link, CF-0130) and one message under the
  // photo: a pick problem, else the upload's error, else the server's own field message.
  const storedPhoto = safeImageUri(produce?.image_url, __DEV__);
  const photoMessage = photoProblem ?? (photo ? null : photoError ?? fieldErrors.photo ?? null);
  const photoButton = (label: string, from: 'library' | 'camera') => (
    <TouchableOpacity
      style={styles.photoBtn}
      onPress={() => void pickPhoto(from)}
      disabled={saving}
      accessibilityRole="button"
      activeOpacity={0.85}
    >
      <Text style={styles.photoBtnText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{produce ? 'Edit listing' : 'New listing'}</Text>

            <Text style={styles.label}>Photo</Text>
            <View style={styles.photoRow}>
              {photo ? (
                // Our own picker's local URI (file:// or content://), not a server link.
                <Image
                  source={{ uri: photo.uri }} style={styles.photo} contentFit="cover"
                  accessibilityLabel="The photo you chose"
                />
              ) : storedPhoto ? (
                <Image
                  source={{ uri: storedPhoto }} style={styles.photo} contentFit="cover"
                  accessibilityLabel={produce?.name ? `Photo of ${produce.name}` : 'Listing photo'}
                />
              ) : (
                <View style={[styles.photo, styles.photoEmpty]}>
                  <Text style={styles.photoEmptyText}>No photo</Text>
                </View>
              )}
              <View style={styles.photoActions}>
                {photoButton('Choose photo', 'library')}
                {photoButton('Take photo', 'camera')}
              </View>
            </View>
            {uploading ? (
              <View style={styles.uploadingRow}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={styles.hint}>Uploading photo…</Text>
              </View>
            ) : photoMessage ? (
              <Text style={styles.fieldError}>{photoMessage}</Text>
            ) : (
              <Text style={styles.hint}>PNG, JPG or WebP, up to 5 MB. It uploads when you save.</Text>
            )}

            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={LISTING_NAME_MAX} />
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
                {fieldNote('stock')}
              </View>
            </View>
            {market ? (
              <View accessibilityRole="text">
                <Text style={styles.hint}>{market.range}</Text>
                <Text style={styles.marketAdvice}>{market.advice}</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Harvest date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input} value={harvestDate} onChangeText={setHarvestDate}
              placeholder={today} placeholderTextColor={Colors.textLight}
              autoCapitalize="none" autoCorrect={false} maxLength={10}
              keyboardType="numbers-and-punctuation" accessibilityLabel="Harvest date, year-month-day"
            />
            {fieldNote('harvestDate')}
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
            {fieldNote('bestBefore')}
            <View style={[styles.pills, styles.chipRow]}>
              {[3, 7, 14].map((n) => dateChip(`+${n} days`, addDays(today, n), setBestBefore, bestBefore))}
            </View>
            <Text style={styles.hint}>Buyers stop seeing the listing after its best-before date.</Text>

            <Text style={styles.label}>Minimum order (sale units)</Text>
            <TextInput
              style={styles.input} value={minOrderQty} onChangeText={setMinOrderQty}
              keyboardType="number-pad" accessibilityLabel="Minimum order quantity"
            />
            {fieldNote('minOrderQty')}

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
            {fieldNote('tiers')}
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
              <View style={[styles.pill, styles.pillActive]}>
                <Text style={[styles.pillText, styles.pillTextActive]}>kg</Text>
              </View>
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
            {notes.categorySuggestion && notes.categorySuggestion !== category ? (
              <TouchableOpacity
                style={styles.suggest}
                onPress={() => setCategory(notes.categorySuggestion)}
                accessibilityRole="button"
              >
                <Text style={styles.suggestText}>Use {notes.categorySuggestion}</Text>
              </TouchableOpacity>
            ) : null}
            {notes.topBlocks.map((m) => <Text key={`b-${m}`} style={styles.error}>{m}</Text>)}
            {notes.topFlags.map((m) => <Text key={`f-${m}`} style={styles.flag}>{m}</Text>)}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {produce && onDelete ? (
              <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} disabled={saving} accessibilityRole="button">
                <Text style={styles.deleteText}>Delete listing</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} disabled={saving}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <Button
                label={produce ? 'Save' : 'Create'} onPress={handleSave} loading={saving}
                disabled={hasBlocks(notes)} style={styles.saveBtn}
              />
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
  // S6: the photo picker row (a 96 px preview and the two buttons).
  photoRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  photo: {
    width: 96, height: 96, borderRadius: Radius.md, backgroundColor: Colors.surfaceAlt,
    borderWidth: 1, borderColor: Colors.border,
  },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  photoEmptyText: { fontSize: FontSize.xs, color: Colors.textLight },
  photoActions: { flex: 1, gap: Spacing.sm },
  photoBtn: {
    paddingVertical: 10, paddingHorizontal: Spacing.md, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
  },
  photoBtnText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  pill: {
    paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipRow: { marginTop: Spacing.sm, flexWrap: 'wrap' },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, marginTop: Spacing.xs },
  marketAdvice: { fontSize: FontSize.xs, color: Colors.text, marginTop: Spacing.xs },
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
  // Guardrails: a soft flag (the listing goes to an admin), not an error.
  fieldFlag: { color: FLAG_TEXT, fontSize: FontSize.xs, marginTop: 4 },
  flag: { color: FLAG_TEXT, fontSize: FontSize.sm, marginTop: Spacing.sm },
  suggest: { minHeight: 44, justifyContent: 'center' },
  suggestText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl, alignItems: 'center' },
  cancelBtn: {
    flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  cancelText: { color: Colors.text, fontWeight: '600', fontSize: FontSize.sm },
  saveBtn: { flex: 1 },
});

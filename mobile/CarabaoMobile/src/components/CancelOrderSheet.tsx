// A farm must say why before cancelling (web: merchant CancelOrderForm). The
// reason goes to the buyer by notification and SMS. Keys mirror
// MERCHANT_CANCEL_REASONS in backend/app/services/order_status.py.
import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';

export const MERCHANT_CANCEL_REASONS = [
  { key: 'out_of_stock', label: 'Out of stock' },
  { key: 'quality', label: "Produce didn't meet quality standards" },
  { key: 'cannot_deliver', label: "Can't deliver to this address or date" },
  { key: 'buyer_request', label: 'The buyer asked to cancel' },
  { key: 'other', label: 'Other' },
] as const;
export type MerchantCancelReason = (typeof MERCHANT_CANCEL_REASONS)[number]['key'];
export const MERCHANT_CANCEL_NOTE_MAX = 300;

type Props = {
  orderId: number | null;
  onClose: () => void;
  /** Rejects with the API error, which is shown in the sheet. */
  onSubmit: (reason: MerchantCancelReason, note: string) => Promise<void>;
};

export function CancelOrderSheet({ orderId, onClose, onSubmit }: Props) {
  const [reason, setReason] = useState<MerchantCancelReason | null>(null);
  const [note, setNote] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const noteRequired = reason === 'other';

  const reset = () => {
    setReason(null); setNote(''); setReasonError(null); setNoteError(null); setError(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async () => {
    const rErr = reason ? null : 'Choose why you are cancelling.';
    const nErr = noteRequired && !note.trim() ? 'Tell the buyer why you are cancelling.' : null;
    setReasonError(rErr);
    setNoteError(nErr);
    setError(null);
    if (rErr || nErr || !reason) return;
    setBusy(true);
    try {
      await onSubmit(reason, note);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The order could not be cancelled. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={orderId != null} animationType="slide" transparent onRequestClose={close}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Cancel order #{orderId}?</Text>
            <Text style={styles.text}>
              The buyer will be refunded by Carabao and the stock returned to your listing. We&apos;ll send them the reason you choose.
            </Text>

            <Text style={styles.label}>Why are you cancelling?</Text>
            <View
              style={[styles.reasons, reasonError ? styles.invalid : null]}
              accessibilityRole="radiogroup"
            >
              {MERCHANT_CANCEL_REASONS.map((r) => {
                const selected = reason === r.key;
                return (
                  <TouchableOpacity
                    key={r.key}
                    style={styles.reason}
                    disabled={busy}
                    onPress={() => { setReason(r.key); setReasonError(null); setNoteError(null); }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                  >
                    <View style={[styles.radio, selected && styles.radioOn]}>
                      {selected ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text style={styles.reasonText}>{r.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {reasonError ? <Text style={styles.fieldError} accessibilityRole="alert">{reasonError}</Text> : null}

            <Text style={styles.label}>{noteRequired ? 'Message to the buyer' : 'Message to the buyer (optional)'}</Text>
            <TextInput
              style={[styles.input, noteError ? styles.invalid : null]}
              value={note}
              onChangeText={(t) => { setNote(t); if (noteError) setNoteError(null); }}
              editable={!busy}
              multiline
              maxLength={MERCHANT_CANCEL_NOTE_MAX}
              placeholder={noteRequired ? 'What happened?' : 'Anything else they should know'}
              placeholderTextColor={Colors.textLight}
              accessibilityLabel="Message to the buyer"
            />
            {noteError ? <Text style={styles.fieldError} accessibilityRole="alert">{noteError}</Text> : null}

            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            <TouchableOpacity style={[styles.danger, busy && styles.disabled]} onPress={submit} disabled={busy} accessibilityRole="button">
              <Text style={styles.dangerText}>{busy ? 'Cancelling…' : 'Cancel order and notify buyer'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancel} onPress={close} disabled={busy} accessibilityRole="button">
              <Text style={styles.cancelText}>Keep order</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: Colors.white, padding: Spacing.lg, maxHeight: '90%', borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg },
  title: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.error, marginBottom: Spacing.sm },
  text: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  label: { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600', marginTop: Spacing.md, marginBottom: 6 },
  reasons: { borderWidth: 1.5, borderColor: 'transparent', borderRadius: Radius.md, gap: 2 },
  reason: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: Colors.error },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.error },
  reasonText: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  input: {
    borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    minHeight: 72, fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.surfaceAlt, textAlignVertical: 'top',
  },
  invalid: { borderColor: Colors.error },
  fieldError: { color: Colors.error, fontSize: FontSize.sm, marginTop: 4 },
  error: { color: Colors.error, fontSize: FontSize.sm, marginTop: Spacing.md },
  danger: { marginTop: Spacing.lg, minHeight: 48, borderRadius: Radius.md, backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center' },
  dangerText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
  disabled: { opacity: 0.6 },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
  cancelText: { color: Colors.textMuted, fontWeight: '600', fontSize: FontSize.md },
});

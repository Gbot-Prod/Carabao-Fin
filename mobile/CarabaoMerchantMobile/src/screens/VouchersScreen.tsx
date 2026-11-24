// src/screens/VouchersScreen.tsx
// S15 (plan §5.10): the farm's voucher codes — the web merchant shell's Vouchers tab.
// The rules and words are the web lib/vouchers.ts (src/lib/vouchers.ts mirrors them); the
// server checks every field again and works out the discount itself at checkout, so the farm
// always pays what the API says. A voucher an order used cannot be deleted: turn it off.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View, type TextInputProps,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, ApiError, type ApiVoucher } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { formatDate } from '../lib/format';
import {
  buildVoucherInput, canDelete, checkVoucherDraft, CODE_MAX_LENGTH, deleteConfirmText,
  describeVoucher, EMPTY_DRAFT, firstVoucherError, lastDay, MAX_PERCENT, usesLabel,
  voucherSaveErrors, voucherStatus,
  type VoucherDraft, type VoucherField, type VoucherFieldErrors, type VoucherStatus,
} from '../lib/vouchers';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../lib/theme';
import { Badge, Button } from '../components/UI';
import { SkeletonList } from '../components/Skeleton';

// The chip colours UI.tsx offers: green while a code can be used, grey when it cannot, amber
// while it waits for its first day.
const STATUS_BADGE: Record<VoucherStatus, 'green' | 'gray' | 'yellow'> = {
  active: 'green', off: 'gray', scheduled: 'yellow', expired: 'gray', 'used up': 'gray',
};

/** The call that holds the form or one row while it runs; null when nothing is happening. */
type Busy = { kind: 'create' } | { kind: 'toggle' | 'delete'; id: number } | null;

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export default function VouchersScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const [vouchers, setVouchers] = useState<ApiVoucher[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<VoucherDraft>(EMPTY_DRAFT);
  const [fieldErrors, setFieldErrors] = useState<VoucherFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // A promise chain, not async/await, as NotificationsScreen does: the setState calls land in
  // the callbacks, so the effect below reads on and never cascades a render.
  const load = useCallback(
    () =>
      api.merchants
        .vouchers(token)
        .then((list) => {
          setVouchers(list);
          setLoadError(null);
        })
        .catch((err: unknown) => {
          setLoadError(errorText(err, 'Could not load your vouchers.'));
        }),
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  /** One box changed: its old message goes, and the draft keeps the text as typed. */
  const edit = (field: VoucherField) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setFieldErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  const create = async () => {
    const errors = checkVoucherDraft(draft);
    setFieldErrors(errors);
    setFormError(null);
    if (firstVoucherError(errors)) return;
    setBusy({ kind: 'create' });
    try {
      const made = await api.merchants.createVoucher(token, buildVoucherInput(draft));
      setVouchers((list) => [made, ...(list ?? [])]);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      // CF-0123: the server names the field it refused, so its words land under that box.
      const placed = voucherSaveErrors(
        errorText(err, 'Could not create the voucher.'),
        err instanceof ApiError ? err.fieldErrors : {},
      );
      setFieldErrors(placed.fields);
      setFormError(placed.top);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (v: ApiVoucher) => {
    setRowError(null);
    setBusy({ kind: 'toggle', id: v.id });
    try {
      const updated = await api.merchants.updateVoucher(token, v.id, { active: !v.active });
      setVouchers((list) => (list ?? []).map((x) => (x.id === v.id ? updated : x)));
    } catch (err) {
      setRowError(errorText(err, 'Could not change the voucher.'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (v: ApiVoucher) => {
    setRowError(null);
    setBusy({ kind: 'delete', id: v.id });
    try {
      await api.merchants.deleteVoucher(token, v.id);
      setVouchers((list) => (list ?? []).filter((x) => x.id !== v.id));
    } catch (err) {
      // 409 when an order used the code after this list was read: the server's words say so.
      setRowError(errorText(err, 'Could not delete the voucher.'));
    } finally {
      setBusy(null);
    }
  };

  // The web's confirm (merchantConfirm.deleteVoucher). Delete shows only on a code no order
  // used, so this is the ordinary case; the server still answers 409 if one arrives meanwhile.
  const confirmRemove = (v: ApiVoucher) => {
    Alert.alert(deleteConfirmText(v.code), undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { void remove(v); } },
    ]);
  };

  const copyCode = async (v: ApiVoucher) => {
    try {
      await Clipboard.setStringAsync(v.code);
      setCopied(v.id);
    } catch {
      Alert.alert('Could not copy the code', `The code is ${v.code}.`);
    }
  };

  // "Copied" returns to "Copy" on its own.
  useEffect(() => {
    if (copied === null) return undefined;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Vouchers</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void refresh(); }}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>New voucher</Text>
          <Text style={styles.hint}>
            Buyers enter the code at checkout. The discount comes off your produce subtotal (not
            the delivery fee), and your payout is the lower total.
          </Text>
          {formError ? (
            <Text style={styles.error} accessibilityRole="alert">{formError}</Text>
          ) : null}

          <FieldInput
            label="Code"
            value={draft.code}
            onChangeText={edit('code')}
            maxLength={CODE_MAX_LENGTH}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="SAVE10"
            error={fieldErrors.code}
            editable={busy === null}
            accessibilityLabel="Voucher code"
          />

          <View style={styles.field}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.chips}>
              <Choice
                label="Percent off"
                active={draft.kind === 'percent'}
                disabled={busy !== null}
                onPress={() => setDraft((d) => ({ ...d, kind: 'percent' }))}
              />
              <Choice
                label="Pesos off"
                active={draft.kind === 'fixed'}
                disabled={busy !== null}
                onPress={() => setDraft((d) => ({ ...d, kind: 'fixed' }))}
              />
            </View>
          </View>

          <FieldInput
            label={draft.kind === 'percent' ? `Percent (1–${MAX_PERCENT})` : 'Pesos off'}
            value={draft.value}
            onChangeText={edit('value')}
            keyboardType="number-pad"
            placeholder={draft.kind === 'percent' ? '10' : '100'}
            error={fieldErrors.value}
            editable={busy === null}
            accessibilityLabel={draft.kind === 'percent' ? 'Percent off' : 'Pesos off'}
          />
          {draft.kind === 'percent' ? (
            <FieldInput
              label="Up to ₱ (optional)"
              value={draft.maxDiscount}
              onChangeText={edit('maxDiscount')}
              keyboardType="number-pad"
              placeholder="No cap"
              error={fieldErrors.maxDiscount}
              editable={busy === null}
              accessibilityLabel="Maximum discount in pesos"
            />
          ) : null}
          <FieldInput
            label="Minimum spend ₱ (optional)"
            value={draft.minSubtotal}
            onChangeText={edit('minSubtotal')}
            keyboardType="number-pad"
            placeholder="No minimum"
            error={fieldErrors.minSubtotal}
            editable={busy === null}
            accessibilityLabel="Minimum spend in pesos"
          />
          <FieldInput
            label="Total uses (optional)"
            value={draft.usageLimit}
            onChangeText={edit('usageLimit')}
            keyboardType="number-pad"
            placeholder="Unlimited"
            error={fieldErrors.usageLimit}
            editable={busy === null}
            accessibilityLabel="Total uses"
          />
          <FieldInput
            label="Uses per buyer"
            value={draft.perUserLimit}
            onChangeText={edit('perUserLimit')}
            keyboardType="number-pad"
            placeholder="1"
            error={fieldErrors.perUserLimit}
            editable={busy === null}
            accessibilityLabel="Uses per buyer"
          />
          <FieldInput
            label="First day (optional)"
            value={draft.startsOn}
            onChangeText={edit('startsOn')}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="2026-12-01"
            error={fieldErrors.startsOn}
            editable={busy === null}
            accessibilityLabel="First day, year-month-day"
          />
          <FieldInput
            label="Last day (optional)"
            value={draft.endsOn}
            onChangeText={edit('endsOn')}
            keyboardType="numbers-and-punctuation"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="2026-12-31"
            error={fieldErrors.endsOn}
            editable={busy === null}
            accessibilityLabel="Last day, year-month-day"
          />
          <Text style={styles.hint}>
            Days are Manila dates, YYYY-MM-DD. A code works through its whole last day.
          </Text>

          <Button
            label="Create voucher"
            onPress={() => { void create(); }}
            loading={busy?.kind === 'create'}
            disabled={busy !== null}
            fullWidth
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your vouchers</Text>
          {rowError ? (
            <Text style={styles.error} accessibilityRole="alert">{rowError}</Text>
          ) : null}
          {vouchers === null && !loadError ? (
            <SkeletonList label="Loading your vouchers" rows={2} />
          ) : vouchers === null ? (
            <Text style={styles.error} accessibilityRole="alert">
              {loadError}{' '}
              <Text
                style={styles.retry}
                onPress={() => { void refresh(); }}
                accessibilityRole="button"
                accessibilityLabel="Try again"
              >
                Try again
              </Text>
            </Text>
          ) : vouchers.length === 0 ? (
            <Text style={styles.hint}>No vouchers yet. Create one above.</Text>
          ) : (
            vouchers.map((v) => (
              <VoucherRow
                key={v.id}
                voucher={v}
                busy={busy}
                copied={copied === v.id}
                onToggle={() => { void toggle(v); }}
                onCopy={() => { void copyCode(v); }}
                onDelete={() => confirmRemove(v)}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** One code: what it takes off, its uses and dates, and the switch that turns it on or off. */
function VoucherRow({
  voucher: v, busy, copied, onToggle, onCopy, onDelete,
}: {
  voucher: ApiVoucher;
  busy: Busy;
  copied: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const status = voucherStatus(v);
  const toggling = busy?.kind === 'toggle' && busy.id === v.id;
  const dates = [v.starts_at ? `from ${formatDate(v.starts_at)}` : '', v.expires_at ? `until ${formatDate(lastDay(v.expires_at))}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <View style={styles.voucher}>
      <View style={styles.voucherTop}>
        <Text style={styles.code}>{v.code}</Text>
        <View style={styles.voucherTopRight}>
          <TouchableOpacity
            style={styles.copy}
            onPress={onCopy}
            accessibilityRole="button"
            accessibilityLabel={`Copy the code ${v.code}`}
          >
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={14}
              color={Colors.primaryDark}
            />
            <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
          </TouchableOpacity>
          <Badge label={status} color={STATUS_BADGE[status]} />
        </View>
      </View>
      <Text style={styles.body}>{describeVoucher(v)}</Text>
      <Text style={styles.hint}>Uses {usesLabel(v)}</Text>
      <Text style={styles.hint}>{dates || 'No end date'}</Text>

      <View style={styles.rule} />
      <View style={styles.voucherBottom}>
        <View style={styles.switchRow}>
          <Switch
            value={v.active}
            onValueChange={onToggle}
            disabled={busy !== null}
            trackColor={{ false: Colors.border, true: Colors.primaryLight }}
            thumbColor={v.active ? Colors.primary : Colors.textLight}
            accessibilityLabel={v.active ? `Turn ${v.code} off` : `Turn ${v.code} on`}
          />
          <Text style={styles.label}>{v.active ? 'On' : 'Off'}</Text>
          {toggling ? <ActivityIndicator size="small" color={Colors.primary} /> : null}
        </View>
        {canDelete(v) ? (
          <ActionButton
            label={busy?.kind === 'delete' && busy.id === v.id ? 'Deleting…' : 'Delete'}
            tone="danger"
            onPress={onDelete}
            disabled={busy !== null}
          />
        ) : null}
      </View>
    </View>
  );
}

/** A secondary action: outlined and 44 high, red for the one that removes something. */
function ActionButton({
  label, onPress, disabled, tone = 'plain',
}: { label: string; onPress: () => void; disabled?: boolean; tone?: 'plain' | 'danger' }) {
  return (
    <TouchableOpacity
      style={[styles.action, tone === 'danger' && styles.actionDanger, disabled && styles.actionOff]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label.replace('…', '')}
    >
      <Text style={[styles.actionText, tone === 'danger' && styles.actionTextDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** The type, as two chips: the web's select has the same two choices. */
function Choice({
  label, active, disabled, onPress,
}: { label: string; active: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive, disabled && styles.actionOff]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** A label, a box and its message, so every box on the form looks the same. */
function FieldInput({
  label, error, style, ...input
}: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error ? styles.inputBad : null, style]}
        placeholderTextColor={Colors.textLight}
        {...input}
      />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, backgroundColor: Colors.white,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg,
    gap: Spacing.sm, ...Shadow.sm,
  },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  field: { gap: Spacing.xs },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: FontSize.md,
    color: Colors.text, backgroundColor: Colors.white,
  },
  inputBad: { borderColor: Colors.error, backgroundColor: Colors.errorBg },
  chips: { flexDirection: 'row', gap: Spacing.sm },
  chip: {
    minHeight: 44, paddingHorizontal: Spacing.lg, justifyContent: 'center',
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  chipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  chipTextActive: { color: Colors.primaryDark },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 16 },
  error: { fontSize: FontSize.xs, color: Colors.error, lineHeight: 16 },
  retry: { fontWeight: '700', color: Colors.error, textDecorationLine: 'underline' },
  body: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  voucher: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    padding: Spacing.md, gap: Spacing.xs,
  },
  voucherTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  voucherTopRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  code: { fontSize: FontSize.md, fontWeight: '800', color: Colors.text, letterSpacing: 1 },
  copy: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
    borderRadius: Radius.full, backgroundColor: Colors.primaryLight,
  },
  copyText: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primaryDark },
  rule: { height: 1, backgroundColor: Colors.borderLight, marginVertical: Spacing.xs },
  voucherBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  action: {
    minHeight: 44, paddingHorizontal: Spacing.lg, justifyContent: 'center',
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  actionDanger: { borderColor: Colors.error },
  actionOff: { opacity: 0.5 },
  actionText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  actionTextDanger: { color: Colors.error },
});
